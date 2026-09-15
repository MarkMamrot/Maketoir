import { getAmazonChannelAccess } from '@/lib/channels/amazonCredentials';
import { updateAmazonListingInventory } from '@/lib/channels/amazonSpApi';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getOnlinePickLocationIds } from '@/lib/ims/shopifyInventorySync';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

const OPERATION = 'inventory_update';
const MAX_ATTEMPTS = 5;
const STALE_LOCK_MINUTES = 10;

interface InventoryJobRow {
  id: number;
  operation_key: string;
  payload_json: string | { variantId?: string } | null;
  attempts: number;
}

interface InventoryTargetRow {
  variant_id: string;
  seller_sku: string;
}

function variantIdFromPayload(payload: InventoryJobRow['payload_json']): string {
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return String(parsed?.variantId ?? '').trim();
  } catch { return ''; }
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : 'Amazon inventory update failed.').slice(0, 500);
}

export async function enqueueAmazonInventoryJobs(input: {
  businessId: string;
  channelInstanceId: string;
}): Promise<number> {
  const result = await imsExecute(
    `INSERT INTO ims_sales_channel_jobs
       (business_id, channel_instance_id, provider, operation, operation_key, payload_json)
     SELECT mapping.business_id, mapping.channel_instance_id, 'amazon', ?,
            CONCAT('amazon_inventory:', mapping.variant_id), JSON_OBJECT('variantId', mapping.variant_id)
       FROM ims_sales_channel_product_mappings mapping
       JOIN ims_sales_channel_product_selections selection
         ON selection.business_id = mapping.business_id
        AND selection.channel_instance_id = mapping.channel_instance_id
        AND selection.variant_id = mapping.variant_id
       JOIN ims_product_variants variant
         ON variant.business_id = mapping.business_id AND variant.variant_id = mapping.variant_id
       JOIN ims_products product
         ON product.business_id = mapping.business_id AND product.product_id = variant.product_id
      WHERE mapping.business_id = ? AND mapping.channel_instance_id = ?
        AND mapping.mapping_status = 'linked' AND mapping.variant_id IS NOT NULL
        AND selection.is_selected = 1 AND selection.inventory_enabled = 1
        AND COALESCE(product.is_stock_item, 1) = 1
     ON DUPLICATE KEY UPDATE
       payload_json = VALUES(payload_json),
       status = IF(status = 'processing', status, 'pending'),
       attempts = IF(status = 'processing', attempts, 0),
       available_at = IF(status = 'processing', available_at, CURRENT_TIMESTAMP(3)),
       completed_at = IF(status = 'processing', completed_at, NULL),
       safe_error = IF(status = 'processing', safe_error, NULL)`,
    [OPERATION, input.businessId, input.channelInstanceId],
  );
  return Number(result.affectedRows ?? 0);
}

export async function enqueueChangedAmazonInventoryJobs(input: {
  businessId: string;
  channelInstanceId: string;
}): Promise<number> {
  const cursorKey = `amazon_inventory_cursor:${input.channelInstanceId}`;
  const cursorRows = await imsQuery<{ value: string }>(
    `SELECT value FROM ims_settings WHERE business_id = ? AND \`key\` = ? LIMIT 1`,
    [input.businessId, cursorKey],
  );
  const cursor = Math.max(0, Math.floor(Number(cursorRows[0]?.value ?? 0)));
  const watermarkRows = await imsQuery<{ watermark: number | string | null }>(
    `SELECT MAX(id) AS watermark FROM ims_stock_movements WHERE business_id = ?`,
    [input.businessId],
  );
  const watermark = Math.max(cursor, Math.floor(Number(watermarkRows[0]?.watermark ?? cursor)));
  if (watermark === cursor) return 0;

  const result = await imsExecute(
    `INSERT INTO ims_sales_channel_jobs
       (business_id, channel_instance_id, provider, operation, operation_key, payload_json)
     SELECT mapping.business_id, mapping.channel_instance_id, 'amazon', ?,
            CONCAT('amazon_inventory:', mapping.variant_id, ':', MAX(movement.id)),
            JSON_OBJECT('variantId', mapping.variant_id, 'stockMovementId', MAX(movement.id))
       FROM ims_stock_movements movement
       JOIN ims_sales_channel_product_mappings mapping
         ON mapping.business_id = movement.business_id AND mapping.variant_id = movement.variant_id
       JOIN ims_sales_channel_product_selections selection
         ON selection.business_id = mapping.business_id
        AND selection.channel_instance_id = mapping.channel_instance_id
        AND selection.variant_id = mapping.variant_id
       JOIN ims_product_variants variant
         ON variant.business_id = mapping.business_id AND variant.variant_id = mapping.variant_id
       JOIN ims_products product
         ON product.business_id = mapping.business_id AND product.product_id = variant.product_id
      WHERE movement.business_id = ? AND movement.id > ? AND movement.id <= ?
        AND mapping.channel_instance_id = ? AND mapping.mapping_status = 'linked'
        AND selection.is_selected = 1 AND selection.inventory_enabled = 1
        AND COALESCE(product.is_stock_item, 1) = 1
      GROUP BY mapping.business_id, mapping.channel_instance_id, mapping.variant_id
     ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json)`,
    [OPERATION, input.businessId, cursor, watermark, input.channelInstanceId],
  );
  await imsExecute(
    `INSERT INTO ims_settings (business_id, \`key\`, value) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [input.businessId, cursorKey, String(watermark)],
  );
  return Number(result.affectedRows ?? 0);
}

async function loadInventoryTarget(input: {
  businessId: string;
  channelInstanceId: string;
  variantId: string;
}): Promise<InventoryTargetRow | null> {
  const rows = await imsQuery<InventoryTargetRow>(
    `SELECT mapping.variant_id, mapping.external_variant_id AS seller_sku
       FROM ims_sales_channel_product_mappings mapping
       JOIN ims_sales_channel_product_selections selection
         ON selection.business_id = mapping.business_id
        AND selection.channel_instance_id = mapping.channel_instance_id
        AND selection.variant_id = mapping.variant_id
       JOIN ims_product_variants variant
         ON variant.business_id = mapping.business_id AND variant.variant_id = mapping.variant_id
       JOIN ims_products product
         ON product.business_id = mapping.business_id AND product.product_id = variant.product_id
      WHERE mapping.business_id = ? AND mapping.channel_instance_id = ? AND mapping.variant_id = ?
        AND mapping.mapping_status = 'linked' AND selection.is_selected = 1
        AND selection.inventory_enabled = 1 AND COALESCE(product.is_stock_item, 1) = 1
      LIMIT 1`,
    [input.businessId, input.channelInstanceId, input.variantId],
  );
  return rows[0] ?? null;
}

async function computeAmazonAvailability(variantId: string, locationIds: number[]): Promise<number> {
  if (locationIds.length === 0) throw new Error('No online stock locations are configured.');
  const placeholders = locationIds.map(() => '?').join(',');
  const rows = await imsQuery<{ available: number | string | null }>(
    `SELECT COALESCE(SUM(GREATEST(0, qty_on_hand - qty_committed)), 0) AS available
       FROM ims_stock WHERE variant_id = ? AND location_id IN (${placeholders})`,
    [variantId, ...locationIds],
  );
  return Math.max(0, Math.floor(Number(rows[0]?.available ?? 0)));
}

export async function processAmazonInventoryJobs(input: {
  businessId: string;
  channelInstanceId: string;
  limit?: number;
}): Promise<{ processed: number; pushed: number; skipped: number; failed: number }> {
  const result = { processed: 0, pushed: 0, skipped: 0, failed: 0 };
  await imsExecute(
    `UPDATE ims_sales_channel_jobs
        SET status = 'pending', locked_at = NULL, available_at = CURRENT_TIMESTAMP(3),
            safe_error = 'Recovered after an interrupted inventory worker.'
      WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'
        AND operation = ? AND status = 'processing'
        AND locked_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE)`,
    [input.businessId, input.channelInstanceId, OPERATION, STALE_LOCK_MINUTES],
  );
  const jobs = await imsQuery<InventoryJobRow>(
    `SELECT id, operation_key, payload_json, attempts
       FROM ims_sales_channel_jobs
      WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'
        AND operation = ? AND status = 'pending' AND available_at <= CURRENT_TIMESTAMP(3)
      ORDER BY available_at, id LIMIT ?`,
    [input.businessId, input.channelInstanceId, OPERATION,
      Math.max(1, Math.min(100, Math.floor(input.limit ?? 25)))],
  );
  if (jobs.length === 0) return result;

  const locationIds = await getOnlinePickLocationIds(input.businessId);
  const access = await getAmazonChannelAccess(input.businessId, input.channelInstanceId);
  if (!access) throw new Error('Amazon authorization is missing.');

  for (const job of jobs) {
    const claimed = await imsExecute(
      `UPDATE ims_sales_channel_jobs
          SET status = 'processing', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP(3), safe_error = NULL
        WHERE id = ? AND business_id = ? AND channel_instance_id = ?
          AND provider = 'amazon' AND operation = ? AND status = 'pending'`,
      [job.id, input.businessId, input.channelInstanceId, OPERATION],
    );
    if (Number(claimed.affectedRows ?? 0) !== 1) continue;
    result.processed += 1;
    const variantId = variantIdFromPayload(job.payload_json);
    try {
      const target = variantId ? await loadInventoryTarget({ ...input, variantId }) : null;
      if (!target) {
        await imsExecute(
          `UPDATE ims_sales_channel_jobs SET status = 'complete', completed_at = CURRENT_TIMESTAMP(3), locked_at = NULL
            WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
          [job.id, input.businessId, input.channelInstanceId],
        );
        result.skipped += 1;
        continue;
      }
      const quantity = await computeAmazonAvailability(target.variant_id, locationIds);
      await updateAmazonListingInventory(access.accessToken, access.sellerId, target.seller_sku, quantity);
      await imsExecute(
        `UPDATE ims_sales_channel_jobs
            SET status = 'complete', completed_at = CURRENT_TIMESTAMP(3), locked_at = NULL, safe_error = NULL
          WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
        [job.id, input.businessId, input.channelInstanceId],
      );
      result.pushed += 1;
    } catch (error) {
      const attempts = Number(job.attempts ?? 0) + 1;
      const retry = attempts < MAX_ATTEMPTS;
      await imsExecute(
        `UPDATE ims_sales_channel_jobs
            SET status = ?, available_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
                locked_at = NULL, safe_error = ?
          WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
        [retry ? 'pending' : 'failed', Math.min(3600, 30 * (2 ** Math.max(0, attempts - 1))), safeError(error),
          job.id, input.businessId, input.channelInstanceId],
      );
      await reportRuntimeIssue({
        businessId: input.businessId,
        source: 'amazon.inventory',
        operation: 'push_inventory',
        title: 'Amazon inventory update failed',
        error,
        context: { channelInstanceId: input.channelInstanceId, variantId, attempt: attempts, retry },
        reference: { type: 'sales_channel_job', id: job.id },
      }).catch(() => null);
      result.failed += 1;
    }
  }
  return result;
}

export async function syncAmazonInventoryForChannel(input: {
  businessId: string;
  channelInstanceId: string;
  limit?: number;
}): Promise<{ queued: number; processed: number; pushed: number; skipped: number; failed: number }> {
  return runImsForBusiness(input.businessId, async () => {
    const queued = await enqueueAmazonInventoryJobs(input);
    const processed = await processAmazonInventoryJobs(input);
    return { queued, ...processed };
  });
}

export async function syncChangedAmazonInventoryForChannel(input: {
  businessId: string;
  channelInstanceId: string;
  limit?: number;
}): Promise<{ queued: number; processed: number; pushed: number; skipped: number; failed: number }> {
  return runImsForBusiness(input.businessId, async () => {
    const queued = await enqueueChangedAmazonInventoryJobs(input);
    const processed = await processAmazonInventoryJobs(input);
    return { queued, ...processed };
  });
}