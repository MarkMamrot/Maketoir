/**
 * POST /api/ims/shopify/sync-inventory
 *
 * Pushes IMS stock levels (sum of the Online Pick Locations) to Shopify.
 *
 * Modes (JSON body { mode }):
 *   - 'queue'   : drain the dirty-variant queue across all businesses (cron)
 *   - 'all'     : push every Shopify-linked variant for the current business
 *   - 'preview' : dry-run — return what WOULD be pushed for the current business
 *
 * Auth: x-cron-secret header (cron) OR an authenticated IMS session (manual).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';
import {
  drainInventoryQueue,
  pushInventoryForBusiness,
  getOnlinePickLocationIds,
  getShopifyForBusiness,
  getShopifyInventoryLocationId,
} from '@/lib/ims/shopifyInventorySync';

export const runtime = 'nodejs';
export const maxDuration = 300;

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

/** GET — Shopify locations + current inventory-sync settings for the UI. */
export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;

  const rows = await imsQuery<{ key: string; value: string }>(
    `SELECT \`key\`, value FROM ims_settings WHERE business_id = ?
       AND \`key\` IN ('shopify_inventory_sync_enabled','shopify_inventory_location_id',
                        'online_pick_priority','shopify_inventory_buffer')`,
    [businessId],
  );
  const get = (k: string) => rows.find(r => r.key === k)?.value ?? '';

  // Shopify locations (destination)
  let locations: Array<{ id: number; name: string; active: boolean }> = [];
  try {
    const shopify = await getShopifyForBusiness(businessId);
    if (shopify) locations = await shopify.listLocations();
  } catch {}

  // IMS locations (stock-counting source)
  const imsLocs = await imsQuery<{ id: number; name: string }>(
    `SELECT id, name FROM ims_locations WHERE business_id = ? ORDER BY name`,
    [businessId],
  ).catch(() => [] as { id: number; name: string }[]);

  // Resolve configured pick location ids
  let pickLocationIds: number[] = [];
  try {
    const arr = JSON.parse(get('online_pick_priority') || '[]');
    if (Array.isArray(arr) && arr.length) pickLocationIds = arr.map(Number).filter(Boolean);
  } catch {}

  const queued = await imsQuery<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ims_shopify_inventory_queue q
       JOIN ims_product_variants v ON v.variant_id = q.variant_id
       JOIN ims_products p ON p.product_id = v.product_id
      WHERE p.business_id = ?`,
    [businessId],
  );

  return NextResponse.json({
    success: true,
    enabled: get('shopify_inventory_sync_enabled') === '1',
    locationId: Number(get('shopify_inventory_location_id') || 0) || null,
    locations,
    imsLocations: imsLocs,
    pickLocationIds,
    buffer: parseInt(get('shopify_inventory_buffer') || '0', 10) || 0,
    queuedCount: queued[0]?.n ?? 0,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode = body?.mode ?? 'queue';
  // Pre-resolved Shopify location ID from the UI (avoids re-fetching with read_locations scope).
  const resolvedShopifyLocationId: number | null = body?.shopifyLocationId ? Number(body.shopifyLocationId) : null;

  // ── Cron path: drain the queue for all businesses ──────────────────────────
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret) {
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    const res = await drainInventoryQueue(Number(body?.limit ?? 250));
    return NextResponse.json({ success: true, ...res });
  }

  // ── Session path: manual actions for the current business ──────────────────
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;

  if (mode === 'queue') {
    const res = await drainInventoryQueue(Number(body?.limit ?? 250));
    return NextResponse.json({ success: true, ...res });
  }

  if (mode === 'all') {
    const res = await pushInventoryForBusiness(businessId, { all: true, force: true, shopifyLocationId: resolvedShopifyLocationId });
    return NextResponse.json({ success: res.errors.length === 0 || res.pushed > 0, ...res });
  }

  if (mode === 'preview') {
    const shopify = await getShopifyForBusiness(businessId);
    if (!shopify) return NextResponse.json({ success: false, error: 'Shopify not connected' });
    const pickLocs = await getOnlinePickLocationIds(businessId);
    const shopifyLocationId = resolvedShopifyLocationId ?? await getShopifyInventoryLocationId(businessId, shopify);
    const buffer = parseInt(
      (await imsQuery<{ value: string }>(
        `SELECT value FROM ims_settings WHERE business_id = ? AND \`key\` = 'shopify_inventory_buffer' LIMIT 1`,
        [businessId],
      ).catch(() => []))[0]?.value || '0', 10) || 0;

    const linked = await imsQuery<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
        WHERE p.business_id = ? AND v.shopify_inventory_item_id IS NOT NULL AND v.shopify_inventory_item_id <> ''`,
      [businessId],
    );
    const sample = await imsQuery<{ sku: string; name: string; available: number }>(
      `SELECT v.sku, p.name,
              GREATEST(0, SUM(GREATEST(0, s.qty_on_hand - s.qty_committed)) - ${Math.max(0, buffer)}) AS available
         FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
         LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id IN (${pickLocs.length ? pickLocs.map(() => '?').join(',') : 'NULL'})
        WHERE p.business_id = ? AND v.shopify_inventory_item_id IS NOT NULL AND v.shopify_inventory_item_id <> ''
        GROUP BY v.variant_id ORDER BY p.name LIMIT 20`,
      [...pickLocs, businessId],
    );
    return NextResponse.json({
      success: true,
      pickLocationIds: pickLocs,
      shopifyLocationId,
      linkedVariants: linked[0]?.n ?? 0,
      buffer,
      sample,
    });
  }

  return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
}
