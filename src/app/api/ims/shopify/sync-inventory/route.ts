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
import { getImsSession } from '@/lib/auth/imsSession';
import { getOnlineChannelCapabilities } from '@/lib/ims/businessOperations';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import { enterImsForBusiness, runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import {
  drainInventoryQueue,
  pushInventoryForShopifyInstance,
} from '@/lib/ims/shopifyInventorySync';

export const runtime = 'nodejs';
export const maxDuration = 300;


/** GET — inventory-sync settings + IMS pick locations for the UI. */
export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  const disabled = await shopifyDisabledResponse(businessId); if (disabled) return disabled;
  const channelInstanceId = new URL(req.url).searchParams.get('channelInstanceId')?.trim();
  if (!channelInstanceId) return NextResponse.json({ error: 'channelInstanceId is required' }, { status: 400 });

  try {
    await enterImsForBusiness(businessId);
    const context = await getShopifyOperationContext({ businessId, channelInstanceId });
    const inventory = shopifyInstanceSettings(context.instance.settings).inventory;

    // IMS locations for display (active only)
    const imsLocs = await imsQuery<{ id: number; name: string }>(
      `SELECT id, name FROM ims_locations WHERE business_id = ? AND is_active = 1 ORDER BY name`,
      [businessId],
    ).catch(() => [] as { id: number; name: string }[]);

    const queued = await imsQuery<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ims_sales_channel_jobs
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'shopify'
          AND operation = 'shopify_inventory' AND status IN ('pending','processing','failed')`,
      [businessId, channelInstanceId],
    ).catch(() => [{ n: 0 }]);

    // Count of Shopify-linked variants (for the preview button state)
    const linked = await imsQuery<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ims_sales_channel_product_mappings
        WHERE business_id = ? AND channel_instance_id = ? AND mapping_status = 'linked'
          AND external_inventory_id IS NOT NULL AND external_inventory_id <> ''`,
      [businessId, channelInstanceId],
    ).catch(() => [{ n: 0 }]);

    return NextResponse.json({
      success: true,
      channelInstanceId,
      enabled: inventory.enabled,
      imsLocations: imsLocs,
      pickLocationIds: inventory.pickLocationIds,
      shopifyLocationId: inventory.locationId,
      buffer: inventory.buffer,
      intervalMinutes: inventory.intervalMinutes,
      lastRunAt: inventory.lastRunAt,
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
    // Each tenant's queue lives in its own schema — drain them one by one
    // inside a bound schema context.
    const businesses = await query<{ business_id: string }>(
      `SELECT business_id FROM businesses
        WHERE deleted_at IS NULL
          AND COALESCE(automation_paused, 0) = 0`,
    ).catch(() => [] as { business_id: string }[]);
    const totals = { processed: 0, pushed: 0, businesses: 0, skipped: 0, errors: [] as string[] };
    for (const { business_id } of businesses) {
      try {
        const capabilities = await getOnlineChannelCapabilities(business_id);
        if (!capabilities.shopifyEnabled) {
          totals.skipped += 1;
          continue;
        }
        const res = await runImsForBusiness(business_id, async () => {
          const result = await drainInventoryQueue(Number(body?.limit ?? 250), business_id);
          return { skipped: false, ...result };
        });
        if (res.skipped) {
          totals.skipped += 1;
          continue;
        }
        totals.processed += res.processed;
        totals.pushed += res.pushed;
        totals.businesses += res.businesses;
        totals.errors.push(...res.errors);
      } catch (e: any) {
        totals.errors.push(`${business_id}: ${e?.message ?? 'drain failed'}`);
        await reportRuntimeIssue({
          businessId: business_id,
          source: 'shopify_inventory',
          operation: 'drain_business_queue',
          title: 'Shopify inventory queue drain failed for organisation',
          error: e,
        }).catch(() => null);
      }
    }
    return NextResponse.json(
      { success: totals.errors.length === 0, ...totals },
      { status: totals.errors.length === 0 ? 200 : 502 },
    );
  }

  // ── Session path: manual actions for the current business ──────────────────
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  const disabled = await shopifyDisabledResponse(businessId); if (disabled) return disabled;
  await enterImsForBusiness(businessId);

  if (mode === 'queue') {
    const channelInstanceId = typeof body?.channelInstanceId === 'string' ? body.channelInstanceId.trim() : '';
    if (!channelInstanceId) return NextResponse.json({ error: 'channelInstanceId is required' }, { status: 400 });
    await getShopifyOperationContext({ businessId, channelInstanceId });
    const res = await drainInventoryQueue(Number(body?.limit ?? 250), businessId, channelInstanceId);
    return NextResponse.json({ success: true, ...res });
  }

  const channelInstanceId = typeof body?.channelInstanceId === 'string' ? body.channelInstanceId.trim() : '';
  if (!channelInstanceId) {
    return NextResponse.json({ error: 'channelInstanceId is required' }, { status: 400 });
  }

  if (mode === 'all') {
    const res = await pushInventoryForShopifyInstance({ businessId, channelInstanceId, all: true, force: true });
    return NextResponse.json({
      success: res.pushed > 0,
      ...res,
      totalLinked: res.pushed + res.skipped,
      queuedRemainder: 0,
    });
  }

  if (mode === 'preview') {
    const context = await getShopifyOperationContext({ businessId, channelInstanceId });
    const inventory = shopifyInstanceSettings(context.instance.settings).inventory;
    const pickLocs = inventory.pickLocationIds;
    const buffer = inventory.buffer;

    const linked = await imsQuery<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ims_sales_channel_product_mappings
        WHERE business_id = ? AND channel_instance_id = ? AND mapping_status = 'linked'
          AND external_inventory_id IS NOT NULL AND external_inventory_id <> ''`,
      [businessId, channelInstanceId],
    ).catch(() => [{ n: 0 }]);

    // Full computed list (bounded) of what would be pushed.
    const locFilter = pickLocs.length ? pickLocs.map(() => '?').join(',') : 'NULL';
    const rows = await imsQuery<{ sku: string; name: string; variant_label: string; available: number }>(
      `SELECT v.sku, p.name,
              CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant_label,
              GREATEST(0, SUM(GREATEST(0, s.qty_on_hand - s.qty_committed)) - ${Math.max(0, buffer)}) AS available
         FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
         JOIN ims_sales_channel_product_mappings mapping
           ON BINARY mapping.business_id = BINARY p.business_id
          AND BINARY mapping.variant_id = BINARY v.variant_id
         LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id IN (${locFilter})
        WHERE p.business_id = ? AND mapping.channel_instance_id = ? AND mapping.mapping_status = 'linked'
          AND mapping.external_inventory_id IS NOT NULL AND mapping.external_inventory_id <> ''
          AND COALESCE(p.is_stock_item, 1) = 1
        GROUP BY v.variant_id ORDER BY available DESC, p.name LIMIT 500`,
      [...pickLocs, businessId, channelInstanceId],
    ).catch(() => [] as any[]);

    const inStock = rows.filter(r => Number(r.available) > 0).length;
    const zeroStock = rows.filter(r => Number(r.available) === 0).length;

    return NextResponse.json({
      success: true,
      pickLocationIds: pickLocs,
      shopifyLocationId: inventory.locationId,
      linkedVariants: linked[0]?.n ?? 0,
      buffer,
      inStock,
      zeroStock,
      rows,
    });
  }

  return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
}
