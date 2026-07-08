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
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
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

/** GET — inventory-sync settings + IMS pick locations for the UI. */
export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;

  try {
    const rows = await imsQuery<{ key: string; value: string }>(
      `SELECT \`key\`, value FROM ims_settings WHERE business_id = ?
         AND \`key\` IN ('shopify_inventory_sync_enabled','online_pick_priority','shopify_inventory_buffer')`,
      [businessId],
    ).catch(() => [] as { key: string; value: string }[]);
    const get = (k: string) => rows.find(r => r.key === k)?.value ?? '';

    // IMS locations for display (active only)
    const imsLocs = await imsQuery<{ id: number; name: string }>(
      `SELECT id, name FROM ims_locations WHERE business_id = ? AND is_active = 1 ORDER BY name`,
      [businessId],
    ).catch(() => [] as { id: number; name: string }[]);

    // Resolve configured pick location ids from setting
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
    ).catch(() => [{ n: 0 }]);

    // Count of Shopify-linked variants (for the preview button state)
    const linked = await imsQuery<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
        WHERE p.business_id = ? AND v.shopify_inventory_item_id IS NOT NULL AND v.shopify_inventory_item_id <> ''`,
      [businessId],
    ).catch(() => [{ n: 0 }]);

    return NextResponse.json({
      success: true,
      enabled: get('shopify_inventory_sync_enabled') === '1',
      imsLocations: imsLocs,
      pickLocationIds,
      buffer: parseInt(get('shopify_inventory_buffer') || '0', 10) || 0,
      queuedCount: queued[0]?.n ?? 0,
      linkedVariants: linked[0]?.n ?? 0,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? 'Failed to load' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (e: any) {
    console.error('[sync-inventory] POST error:', e?.message, e?.stack);
    return NextResponse.json({ success: false, error: e?.message ?? 'Internal error' }, { status: 500 });
  }
}

async function handlePost(req: Request) {
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
    // Fetch every Shopify-linked variant for this business.
    const linked = await imsQuery<{ variant_id: string }>(
      `SELECT v.variant_id
         FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
        WHERE p.business_id = ? AND v.shopify_inventory_item_id IS NOT NULL AND v.shopify_inventory_item_id <> ''`,
      [businessId],
    );
    const allIds = linked.map(r => r.variant_id);
    if (!allIds.length) {
      return NextResponse.json({ success: false, error: 'No Shopify-linked variants found. Run Reconcile Products first.' });
    }

    // Push a bounded first batch inline (keeps the request well under proxy timeouts);
    // enqueue the remainder for the 15-minute background cron. Bulk GraphQL pushes
    // 250 variants per call (~1.5s), so a few thousand inline stays under the limit.
    const BATCH = 2000;
    const firstBatch = allIds.slice(0, BATCH);
    const remainder  = allIds.slice(BATCH);

    const res = await pushInventoryForBusiness(businessId, { variantIds: firstBatch, force: true });

    // If the first batch failed with a scope/permission error, don't queue the rest —
    // they'd all fail too. Surface the error immediately.
    const hadScopeError = res.errors.some(e => /write_inventory|forbidden|403/i.test(e));

    let queuedRemainder = 0;
    if (remainder.length && !hadScopeError) {
      // INSERT IGNORE into the dirty queue so the cron drains them.
      const values = remainder.map(() => '(?, NOW())').join(',');
      await imsExecute(
        `INSERT IGNORE INTO ims_shopify_inventory_queue (variant_id, queued_at) VALUES ${values}`,
        remainder,
      ).catch(() => {});
      queuedRemainder = remainder.length;
    }

    return NextResponse.json({
      success: res.pushed > 0,
      ...res,
      totalLinked: allIds.length,
      queuedRemainder,
    });
  }

  if (mode === 'preview') {
    const pickLocs = await getOnlinePickLocationIds(businessId);
    const buffer = parseInt(
      (await imsQuery<{ value: string }>(
        `SELECT value FROM ims_settings WHERE business_id = ? AND \`key\` = 'shopify_inventory_buffer' LIMIT 1`,
        [businessId],
      ).catch(() => []))[0]?.value || '0', 10) || 0;

    // Resolve the Shopify location (best-effort — not required to preview stock).
    let shopifyLocationId: number | null = null;
    try {
      const shopify = await getShopifyForBusiness(businessId);
      if (shopify) shopifyLocationId = await getShopifyInventoryLocationId(businessId, shopify);
    } catch {}

    const linked = await imsQuery<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
        WHERE p.business_id = ? AND v.shopify_inventory_item_id IS NOT NULL AND v.shopify_inventory_item_id <> ''`,
      [businessId],
    ).catch(() => [{ n: 0 }]);

    // Full computed list (bounded) of what would be pushed.
    const locFilter = pickLocs.length ? pickLocs.map(() => '?').join(',') : 'NULL';
    const rows = await imsQuery<{ sku: string; name: string; variant_label: string; available: number }>(
      `SELECT v.sku, p.name,
              CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant_label,
              GREATEST(0, SUM(GREATEST(0, s.qty_on_hand - s.qty_committed)) - ${Math.max(0, buffer)}) AS available
         FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
         LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id IN (${locFilter})
        WHERE p.business_id = ? AND v.shopify_inventory_item_id IS NOT NULL AND v.shopify_inventory_item_id <> ''
        GROUP BY v.variant_id ORDER BY available DESC, p.name LIMIT 500`,
      [...pickLocs, businessId],
    ).catch(() => [] as any[]);

    const inStock = rows.filter(r => Number(r.available) > 0).length;
    const zeroStock = rows.filter(r => Number(r.available) === 0).length;

    return NextResponse.json({
      success: true,
      pickLocationIds: pickLocs,
      shopifyLocationId,
      linkedVariants: linked[0]?.n ?? 0,
      buffer,
      inStock,
      zeroStock,
      rows,
    });
  }

  return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
}
