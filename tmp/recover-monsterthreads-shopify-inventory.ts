import 'dotenv/config';

import mysql from 'mysql2/promise';

import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { drainInventoryQueue } from '@/lib/ims/shopifyInventorySync';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

const channelInstanceId = '43e53831-ad2c-4bc7-9bd2-d443974a3b45';
const collationError = 'Illegal mix of collations%';

type JobCount = { status: string; count: number | string };
type MappingRow = { variant_id: string; external_inventory_id: string };
type StockRow = { variant_id: string; available: number | string | null };

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  try {
    const [businessRows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT business_id FROM businesses WHERE name = 'Monsterthreads' AND deleted_at IS NULL LIMIT 1`,
    );
    const businessId = String(businessRows[0]?.business_id ?? '').trim();
    if (!businessId) throw new Error('Monsterthreads business was not found.');

    const result = await runImsForBusiness(businessId, async () => {
      const unexpectedFailures = await imsQuery<{ safe_error: string | null; count: number | string }>(
        `SELECT safe_error, COUNT(*) AS count FROM ims_sales_channel_jobs
          WHERE business_id = ? AND channel_instance_id = ? AND provider = 'shopify'
            AND operation = 'shopify_inventory' AND status = 'failed'
            AND (safe_error IS NULL OR safe_error NOT LIKE ?)
          GROUP BY safe_error`,
        [businessId, channelInstanceId, collationError],
      );
      if (unexpectedFailures.length > 0) {
        throw new Error(`Unexpected failed inventory jobs require review: ${JSON.stringify(unexpectedFailures)}`);
      }
      const reset = await imsExecute(
        `UPDATE ims_sales_channel_jobs
            SET status = 'pending', attempts = 0, available_at = CURRENT_TIMESTAMP(3),
                locked_at = NULL, completed_at = NULL, safe_error = NULL
          WHERE business_id = ? AND channel_instance_id = ? AND provider = 'shopify'
            AND operation = 'shopify_inventory' AND status = 'failed' AND safe_error LIKE ?`,
        [businessId, channelInstanceId, collationError],
      );
      console.log(JSON.stringify({ stage: 'reset_complete', resetFailedJobs: Number(reset.affectedRows ?? 0) }));
      console.log(JSON.stringify({ stage: 'drain_start' }));
      const drain = await drainInventoryQueue(4000, businessId, channelInstanceId);
      console.log(JSON.stringify({ stage: 'drain_complete', drain }));
      if (drain.errors.length > 0) throw new Error(`Inventory recovery failed: ${drain.errors.join('; ')}`);

      const jobs = await imsQuery<JobCount>(
        `SELECT status, COUNT(*) AS count FROM ims_sales_channel_jobs
          WHERE business_id = ? AND channel_instance_id = ? AND provider = 'shopify'
            AND operation = 'shopify_inventory' GROUP BY status`,
        [businessId, channelInstanceId],
      );
      const incomplete = jobs.filter(row => row.status !== 'complete' && Number(row.count) > 0);
      if (incomplete.length > 0) throw new Error(`Inventory jobs remain incomplete: ${JSON.stringify(incomplete)}`);

      const recentVariants = await imsQuery<{ variant_id: string }>(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.variantId')) AS variant_id
           FROM ims_sales_channel_jobs
          WHERE business_id = ? AND channel_instance_id = ? AND provider = 'shopify'
            AND operation = 'shopify_inventory' AND status = 'complete'
          GROUP BY JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.variantId'))
          ORDER BY MAX(completed_at) DESC LIMIT 50`,
        [businessId, channelInstanceId],
      );
      const variantIds = recentVariants.map(row => row.variant_id).filter(Boolean);
      const placeholders = variantIds.map(() => '?').join(',');
      const mappings = variantIds.length === 0 ? [] : await imsQuery<MappingRow>(
        `SELECT mapping.variant_id, mapping.external_inventory_id
           FROM ims_sales_channel_product_mappings mapping
          WHERE mapping.business_id = ? AND mapping.channel_instance_id = ?
            AND mapping.mapping_status = 'linked' AND mapping.variant_id IN (${placeholders})
            AND mapping.external_inventory_id IS NOT NULL AND mapping.external_inventory_id <> ''`,
        [businessId, channelInstanceId, ...variantIds],
      );
      const context = await getShopifyOperationContext({ businessId, channelInstanceId });
      const inventory = shopifyInstanceSettings(context.instance.settings).inventory;
      const locationPlaceholders = inventory.pickLocationIds.map(() => '?').join(',');
      const mappingVariantIds = mappings.map(row => row.variant_id);
      const mappingPlaceholders = mappingVariantIds.map(() => '?').join(',');
      const stock = mappingVariantIds.length === 0 ? [] : await imsQuery<StockRow>(
        `SELECT variant_id, SUM(GREATEST(0, qty_on_hand - qty_committed)) AS available
           FROM ims_stock
          WHERE location_id IN (${locationPlaceholders}) AND variant_id IN (${mappingPlaceholders})
          GROUP BY variant_id`,
        [...inventory.pickLocationIds, ...mappingVariantIds],
      );
      const stockByVariant = new Map(stock.map(row => [row.variant_id,
        Math.max(0, Number(row.available ?? 0) - inventory.buffer)]));
      const service = new ShopifyService(context.credentials.shopDomain, context.credentials.token);
      const levels = await service.getInventoryLevels(
        mappings.map(row => row.external_inventory_id),
        [inventory.locationId!],
      );
      const levelByInventoryId = new Map(levels.map(level => [level.inventoryItemId, level.available]));
      const mismatches = mappings.flatMap(mapping => {
        const expected = stockByVariant.get(mapping.variant_id) ?? 0;
        const actual = levelByInventoryId.get(mapping.external_inventory_id);
        return actual === expected ? [] : [{ variantId: mapping.variant_id, expected, actual: actual ?? null }];
      });
      if (mismatches.length > 0) {
        throw new Error(`Shopify inventory readback found ${mismatches.length} mismatches: ${JSON.stringify(mismatches.slice(0, 10))}`);
      }
      return {
        resetFailedJobs: Number(reset.affectedRows ?? 0),
        drain,
        jobs,
        readbackChecked: mappings.length,
        readbackMismatches: mismatches.length,
        lastRunAt: shopifyInstanceSettings((await getShopifyOperationContext({ businessId, channelInstanceId })).instance.settings).inventory.lastRunAt,
      };
    });
    console.log(JSON.stringify({ channelInstanceId, ...result }, null, 2));
  } finally {
    await connection.end();
  }
}

main().then(() => process.exit(0)).catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});