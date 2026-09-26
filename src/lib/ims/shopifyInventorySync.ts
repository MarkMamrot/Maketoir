/**
 * IMS → Shopify inventory sync.
 *
 * The online store's available quantity = SUM over the configured Online Pick
 * Location(s) of GREATEST(0, qty_on_hand - qty_committed). This is pushed to
 * Shopify as an absolute "available" level (set, not adjust) so it self-corrects
 * and never double-counts against Shopify's own order decrements.
 *
 * A DB trigger on ims_stock_movements queues every touched variant into
 * ims_shopify_inventory_queue; drainInventoryQueue() processes that queue.
 */
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { createNotification } from '@/lib/ims/createNotification';
import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function shouldRunInventorySync(lastRunAt: string | null | undefined, intervalMinutes: number, now = new Date()): boolean {
  const mins = Math.max(1, Math.floor(Number(intervalMinutes) || 15));
  if (!lastRunAt) return true;
  const last = new Date(lastRunAt);
  if (Number.isNaN(last.getTime())) return true;
  return now.getTime() - last.getTime() >= mins * 60 * 1000;
}

async function getSetting(businessId: string, key: string): Promise<string> {
  const rows = await imsQuery<{ value: string }>(
    `SELECT value FROM ims_settings WHERE business_id = ? AND \`key\` = ? LIMIT 1`,
    [businessId, key],
  );
  return rows[0]?.value ?? '';
}

/** Online pick location ids (priority list, else the single online sales location). */
export async function getOnlinePickLocationIds(businessId: string): Promise<number[]> {
  const pri = await getSetting(businessId, 'online_pick_priority');
  try {
    const arr = JSON.parse(pri || '[]');
    if (Array.isArray(arr) && arr.length) return arr.map(Number).filter(Boolean);
  } catch {}
  const single = Number(await getSetting(businessId, 'online_sales_location_id') || 0);
  return single ? [single] : [];
}

/**
 * Returns `{ price, compare_at_price }` for a Shopify variant update/create.
 *
 *  - Sale active  → price = sale price (what customer pays),
 *                   compare_at_price = regular RRP (shown crossed-out).
 *  - No sale      → price = regular RRP, compare_at_price = null.
 */
export function shopifyVariantPricePayload(
  price_rrp:      number | null | undefined,
  price_rrp_sale: number | null | undefined,
): { price: string; compare_at_price: string | null } {
  const isOnSale = price_rrp_sale != null && Number(price_rrp_sale) > 0;
  return {
    price:            (isOnSale ? Number(price_rrp_sale) : Number(price_rrp ?? 0)).toFixed(2),
    compare_at_price: isOnSale ? Number(price_rrp ?? 0).toFixed(2) : null,
  };
}

export function shopifyInventoryPolicyPayload(isStockItem: number | boolean | null | undefined) {
  const tracksInventory = Number(isStockItem ?? 1) === 1;
  return tracksInventory
    ? { inventory_management: 'shopify', inventory_policy: 'deny' }
    : { inventory_management: null, inventory_policy: 'continue' };
}

/** Available-to-sell per variant across the counting locations, minus optional buffer. */
async function computeAvailable(
  pickLocationIds: number[],
  variantIds: string[],
  buffer = 0,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!pickLocationIds.length || !variantIds.length) return map;
  const locPh = pickLocationIds.map(() => '?').join(',');
  const varPh = variantIds.map(() => '?').join(',');
  const rows = await imsQuery<{ variant_id: string; available: number }>(
    `SELECT variant_id, SUM(GREATEST(0, qty_on_hand - qty_committed)) AS available
       FROM ims_stock
      WHERE location_id IN (${locPh}) AND variant_id IN (${varPh})
      GROUP BY variant_id`,
    [...pickLocationIds, ...variantIds],
  );
  const buf = Math.max(0, Math.floor(buffer));
  for (const r of rows) map.set(r.variant_id, Math.max(0, Number(r.available ?? 0) - buf));
  return map;
}

export interface PushResult { pushed: number; skipped: number; errors: string[]; locationId: number | null }

/**
 * Push absolute inventory to one exact Shopify instance. The instance's typed
 * settings are the sole source of provider location, IMS locations and buffer.
 */
export async function pushInventoryForShopifyInstance(
  input: {
    businessId: string;
    channelInstanceId: string;
    variantIds?: string[];
    all?: boolean;
    force?: boolean;
  },
): Promise<PushResult> {
  const result: PushResult = { pushed: 0, skipped: 0, errors: [], locationId: null };
  const context = await getShopifyOperationContext(input);
  const settings = shopifyInstanceSettings(context.instance.settings).inventory;
  if (!settings.enabled && !input.force) { result.errors.push('Inventory sync disabled'); return result; }
  const pickLocs = settings.pickLocationIds;
  if (!pickLocs.length) { result.errors.push('No stock counting locations configured'); return result; }
  const shopifyLocationId = settings.locationId;
  if (!shopifyLocationId) { result.errors.push('No Shopify inventory location'); return result; }
  result.locationId = shopifyLocationId;
  const shopify = new ShopifyService(context.credentials.shopDomain, context.credentials.token);

  let linkRows: { variant_id: string; external_inventory_id: string }[];
  if (input.all) {
    linkRows = await imsQuery(
      `SELECT mapping.variant_id, mapping.external_inventory_id
         FROM ims_sales_channel_product_mappings mapping
        JOIN ims_product_variants variant ON BINARY variant.variant_id = BINARY mapping.variant_id
        JOIN ims_products product ON BINARY product.product_id = BINARY variant.product_id
        WHERE mapping.business_id = ? AND mapping.channel_instance_id = ?
          AND mapping.mapping_status = 'linked' AND mapping.variant_id IS NOT NULL
          AND mapping.external_inventory_id IS NOT NULL AND mapping.external_inventory_id <> ''
          AND COALESCE(product.is_stock_item, 1) = 1`,
      [input.businessId, input.channelInstanceId],
    );
  } else {
    const ids = [...new Set(input.variantIds ?? [])];
    if (!ids.length) return result;
    const ph = ids.map(() => '?').join(',');
    linkRows = await imsQuery(
      `SELECT mapping.variant_id, mapping.external_inventory_id
         FROM ims_sales_channel_product_mappings mapping
        JOIN ims_product_variants variant ON BINARY variant.variant_id = BINARY mapping.variant_id
        JOIN ims_products product ON BINARY product.product_id = BINARY variant.product_id
        WHERE mapping.business_id = ? AND mapping.channel_instance_id = ?
          AND mapping.mapping_status = 'linked' AND mapping.variant_id IN (${ph})
          AND mapping.external_inventory_id IS NOT NULL AND mapping.external_inventory_id <> ''
          AND COALESCE(product.is_stock_item, 1) = 1`,
      [input.businessId, input.channelInstanceId, ...ids],
    );
  }
  if (!linkRows.length) return result;

  const availByVariant = await computeAvailable(pickLocs, linkRows.map(r => r.variant_id), settings.buffer);

  // Push in bulk GraphQL batches (up to 250 inventory items per API call).
  // This replaces the old one-REST-call-per-variant loop, which was ~600ms per
  // variant and hit proxy timeouts. A 250-item batch is a single round-trip.
  const BULK = 250;
  for (let i = 0; i < linkRows.length; i += BULK) {
    const chunk = linkRows.slice(i, i + BULK);
    const items = chunk.map(row => ({
      inventoryItemId: row.external_inventory_id,
      available: availByVariant.get(row.variant_id) ?? 0,
    }));
    try {
      const { userErrors } = await shopify.setInventoryLevelsBulk(items, shopifyLocationId);
      if (userErrors.length) {
        // Scope/permission problems surface here as user errors — same for the
        // whole batch, so bail out with a clear message rather than repeating.
        const joined = userErrors.map(e => e.message).join('; ');
        if (/write_inventory|forbidden|access|scope|permission/i.test(joined)) {
          result.errors.push('Shopify token is missing the "write_inventory" scope. Add it to your Shopify custom app (Configuration → Admin API access scopes), reinstall the app, and paste the new access token into Setup → Connections.');
          result.skipped += linkRows.length - result.pushed;
          return result;
        }
        result.errors.push(joined);
        result.skipped += chunk.length;
      } else {
        result.pushed += chunk.length;
      }
    } catch (e: any) {
      const msg = e?.message ?? 'bulk push failed';
      if (/403|forbidden|write_inventory|access denied/i.test(msg)) {
        result.errors.push('Shopify token is missing the "write_inventory" scope. Add it to your Shopify custom app (Configuration → Admin API access scopes), reinstall the app, and paste the new access token into Setup → Connections.');
        result.skipped += linkRows.length - result.pushed;
        return result;
      }
      result.errors.push(`batch @${i}: ${msg}`);
      result.skipped += chunk.length;
    }
    await sleep(250); // gentle pacing between GraphQL calls
  }
  if (result.pushed > 0 && result.errors.length === 0) {
    await SalesChannelInstanceRepository.markShopifyInventorySyncedForBusiness({
      businessId: input.businessId,
      channelInstanceId: input.channelInstanceId,
    }).catch(error => reportRuntimeIssue({
      businessId: input.businessId,
      source: 'shopify_inventory',
      operation: 'record_success',
      title: 'Shopify inventory succeeded but its last-run marker could not be saved',
      error,
      context: { channelInstanceId: input.channelInstanceId, pushed: result.pushed },
    }).catch(() => null));
  }
  return result;
}

const INVENTORY_OPERATION = 'shopify_inventory';

/** Expand legacy variant-only queue rows through exact linked mappings. */
export async function fanOutLegacyShopifyInventoryQueue(businessId: string): Promise<number> {
  const shopifyInstanceIds = (await SalesChannelInstanceRepository.listForBusiness(businessId))
    .filter(instance => instance.provider === 'shopify'
      && instance.enabled
      && instance.runtimeStatus === 'active'
      && instance.readinessStatus === 'ready'
      && shopifyInstanceSettings(instance.settings).inventory.enabled)
    .map(instance => instance.channelInstanceId);
  if (shopifyInstanceIds.length === 0) return 0;
  const instancePlaceholders = shopifyInstanceIds.map(() => '?').join(',');
  const inserted = await imsExecute(
    `INSERT INTO ims_sales_channel_jobs
       (business_id, channel_instance_id, provider, operation, operation_key, payload_json)
     SELECT mapping.business_id, mapping.channel_instance_id, 'shopify', ?,
            CONCAT('shopify_inventory:', mapping.variant_id), JSON_OBJECT('variantId', mapping.variant_id)
       FROM ims_shopify_inventory_queue queue_item
      JOIN ims_product_variants variant ON BINARY variant.variant_id = BINARY queue_item.variant_id
      JOIN ims_products product ON BINARY product.product_id = BINARY variant.product_id
       JOIN ims_sales_channel_product_mappings mapping
         ON BINARY mapping.business_id = BINARY product.business_id
        AND BINARY mapping.variant_id = BINARY variant.variant_id
      WHERE product.business_id = ? AND mapping.channel_instance_id IN (${instancePlaceholders})
        AND mapping.mapping_status = 'linked'
        AND mapping.external_inventory_id IS NOT NULL AND mapping.external_inventory_id <> ''
        AND COALESCE(product.is_stock_item, 1) = 1
     ON DUPLICATE KEY UPDATE
       payload_json = VALUES(payload_json), status = IF(status = 'processing', status, 'pending'),
       attempts = IF(status = 'processing', attempts, 0),
       available_at = IF(status = 'processing', available_at, CURRENT_TIMESTAMP(3)),
       completed_at = IF(status = 'processing', completed_at, NULL),
       safe_error = IF(status = 'processing', safe_error, NULL)`,
    [INVENTORY_OPERATION, businessId, ...shopifyInstanceIds],
  );
  await imsExecute(
    `DELETE queue_item FROM ims_shopify_inventory_queue queue_item
      JOIN ims_product_variants variant ON BINARY variant.variant_id = BINARY queue_item.variant_id
      JOIN ims_products product ON BINARY product.product_id = BINARY variant.product_id
    WHERE product.business_id = ? AND EXISTS (
       SELECT 1 FROM ims_sales_channel_product_mappings mapping
        WHERE BINARY mapping.business_id = BINARY product.business_id
          AND BINARY mapping.variant_id = BINARY variant.variant_id
          AND mapping.channel_instance_id IN (${instancePlaceholders})
          AND mapping.mapping_status = 'linked' AND mapping.external_inventory_id IS NOT NULL
          AND mapping.external_inventory_id <> ''
     )`,
      [businessId, ...shopifyInstanceIds],
  );
  return Number(inserted.affectedRows ?? 0);
}

function jobVariantId(payload: string | Record<string, unknown> | null): string {
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return String(parsed?.variantId ?? '').trim();
  } catch { return ''; }
}

/**
 * Drain exact-instance Shopify inventory jobs for one tenant. A failed store is
 * retained for retry without suppressing successful stores.
 */
export async function drainInventoryQueue(
  limit = 250,
  businessId: string,
  channelInstanceId?: string,
): Promise<{ processed: number; pushed: number; businesses: number; errors: string[] }> {
  await fanOutLegacyShopifyInventoryQueue(businessId);
  const instanceClause = channelInstanceId ? ' AND channel_instance_id = ?' : '';
  const scopeParams = channelInstanceId ? [businessId, INVENTORY_OPERATION, channelInstanceId] : [businessId, INVENTORY_OPERATION];
  await imsExecute(
    `UPDATE ims_sales_channel_jobs
        SET status = 'pending', locked_at = NULL, available_at = CURRENT_TIMESTAMP(3),
            safe_error = 'Recovered after an interrupted Shopify inventory worker.'
      WHERE business_id = ? AND provider = 'shopify' AND operation = ? AND status = 'processing'
        AND locked_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 10 MINUTE)${instanceClause}`,
    scopeParams,
  );
  const safeLimit = Math.max(1, Math.min(Math.floor(Number(limit)), 10000));
  const jobs = await imsQuery<{ id: number; channel_instance_id: string; payload_json: string | Record<string, unknown> | null; attempts: number }>(
    `SELECT id, channel_instance_id, payload_json, attempts
       FROM ims_sales_channel_jobs
      WHERE business_id = ? AND provider = 'shopify' AND operation = ?
        AND status = 'pending' AND available_at <= CURRENT_TIMESTAMP(3)
        ${instanceClause}
      ORDER BY available_at, id LIMIT ${safeLimit}`,
    scopeParams,
  );
  const claimedJobs: typeof jobs = [];
  for (const job of jobs) {
    const claimed = await imsExecute(
      `UPDATE ims_sales_channel_jobs
          SET status = 'processing', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP(3), safe_error = NULL
        WHERE id = ? AND business_id = ? AND channel_instance_id = ?
          AND provider = 'shopify' AND operation = ? AND status = 'pending'`,
      [job.id, businessId, job.channel_instance_id, INVENTORY_OPERATION],
    );
    if (Number(claimed.affectedRows ?? 0) === 1) claimedJobs.push(job);
  }
  const byInstance = new Map<string, typeof jobs>();
  for (const job of claimedJobs) {
    if (!byInstance.has(job.channel_instance_id)) byInstance.set(job.channel_instance_id, []);
    byInstance.get(job.channel_instance_id)!.push(job);
  }
  let pushed = 0;
  const drainErrors: string[] = [];
  let processed = 0;
  for (const [channelInstanceId, instanceJobs] of byInstance) {
    const variantIds = instanceJobs.map(job => jobVariantId(job.payload_json)).filter(Boolean);
    try {
      const res = await pushInventoryForShopifyInstance({ businessId, channelInstanceId, variantIds });
      pushed += res.pushed;
      processed += instanceJobs.length;
      if (res.errors.length) {
        drainErrors.push(...res.errors.slice(0, 3));
        throw new Error(res.errors[0]);
      } else {
        await imsExecute(
          `UPDATE ims_sales_channel_jobs SET status = 'complete', completed_at = CURRENT_TIMESTAMP(3), locked_at = NULL, safe_error = NULL
            WHERE business_id = ? AND channel_instance_id = ? AND id IN (${instanceJobs.map(() => '?').join(',')})`,
          [businessId, channelInstanceId, ...instanceJobs.map(job => job.id)],
        );
        await ImsShopifyRepo.logAction('upload', 'success', `Inventory sync pushed ${res.pushed} variant(s) to Shopify`, businessId, { variant_ids: variantIds, pushed: res.pushed }, channelInstanceId).catch(() => {});
      }
    } catch (e: any) {
      const msg = e?.message ?? 'unknown error';
      drainErrors.push(msg);
      const attempts = Math.max(...instanceJobs.map(job => Number(job.attempts ?? 0) + 1), 1);
      await imsExecute(
        `UPDATE ims_sales_channel_jobs
        SET status = IF(attempts >= 5, 'failed', 'pending'),
                available_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND), locked_at = NULL, safe_error = ?
          WHERE business_id = ? AND channel_instance_id = ? AND id IN (${instanceJobs.map(() => '?').join(',')})`,
        [Math.min(3600, 30 * (2 ** Math.max(0, attempts - 1))), msg.slice(0, 500), businessId, channelInstanceId, ...instanceJobs.map(job => job.id)],
      );
      await reportRuntimeIssue({
        businessId,
        source: 'shopify_inventory',
        operation: 'drain_queue',
        title: 'Shopify inventory update failed',
        error: e,
        context: { channelInstanceId, variantIds, attempt: attempts },
      }).catch(() => null);
      createNotification(
        businessId,
        'shopify_inventory',
        `Shopify inventory update stopped for ${variantIds.length} ${variantIds.length === 1 ? 'product' : 'products'}`,
        `Solvantis could not finish sending inventory for these products to Shopify. Check the connection and product links before retrying.\n\nTechnical reason: ${msg}`,
        { errors: [msg], variant_ids: variantIds, channel_instance_id: channelInstanceId },
      ).catch(err => console.error('[notifications] inventory sync notify failed:', err));
    }
  }
  return { processed, pushed, businesses: byInstance.size, errors: drainErrors };
}
