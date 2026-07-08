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
       AND \`key\` IN ('shopify_inventory_sync_enabled','shopify_inventory_location_id')`,
    [businessId],
  );
  const get = (k: string) => rows.find(r => r.key === k)?.value ?? '';

  let locations: Array<{ id: number; name: string; active: boolean }> = [];
  try {
    const shopify = await getShopifyForBusiness(businessId);
    if (shopify) locations = await shopify.listLocations();
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
    queuedCount: queued[0]?.n ?? 0,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode = body?.mode ?? 'queue';

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
    const res = await pushInventoryForBusiness(businessId, { all: true, force: true });
    return NextResponse.json({ success: res.errors.length === 0 || res.pushed > 0, ...res });
  }

  if (mode === 'preview') {
    const shopify = await getShopifyForBusiness(businessId);
    if (!shopify) return NextResponse.json({ success: false, error: 'Shopify not connected' });
    const pickLocs = await getOnlinePickLocationIds(businessId);
    const shopifyLocationId = await getShopifyInventoryLocationId(businessId, shopify);
    const linked = await imsQuery<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
        WHERE p.business_id = ? AND v.shopify_inventory_item_id IS NOT NULL AND v.shopify_inventory_item_id <> ''`,
      [businessId],
    );
    const sample = await imsQuery<{ sku: string; name: string; available: number }>(
      `SELECT v.sku, p.name, SUM(GREATEST(0, s.qty_on_hand - s.qty_committed)) AS available
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
      sample,
    });
  }

  return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
}
