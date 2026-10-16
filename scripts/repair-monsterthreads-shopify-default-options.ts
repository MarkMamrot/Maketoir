/**
 * Apply only the original 484 approved candidates, revalidating every mapping.
 * npx --no-install tsx scripts\repair-monsterthreads-shopify-default-options.ts
 *   --apply --plan=<absolute preview JSON> --audit=<new absolute JSONL>
 * Add --canary to check the screenshot SKU and the first approved single-option product.
 * Does not write local catalogue, prices, barcodes, inventory levels or mappings.
 */
import 'dotenv/config';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { getPool, query } from '../src/services/MySQLService';
import { getShopifyOperationContext } from '../src/lib/channels/shopifyOperationContext';
import { ShopifyService } from '../src/services/ShopifyService';
import { reportRuntimeIssue } from '../src/lib/runtimeIssues';
import {
  assertShopifyDefaultOptionRepairPreserved, previewShopifyDefaultOptionRepair,
  type ShopifyOptionVariant, type ShopifyDefaultOptionMapping,
} from '../src/lib/ims/shopifyProductOptions';

interface Target {
  productId: string; name: string; sku: string; externalProductId: string;
  externalVariantId: string; externalInventoryId: string;
}
interface Business { business_id: string; ims_db_name: string }
interface Variant extends RowDataPacket, ShopifyOptionVariant { variant_id: string; sku: string | null; is_active: number }
interface Mapping extends RowDataPacket, ShopifyDefaultOptionMapping {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid approved preview object.');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Approved preview contains a missing identifier or SKU.');
  return value;
}
function id(value: unknown, type: string): string {
  const match = text(value).match(new RegExp(`^gid://shopify/${type}/([0-9]+)$`));
  if (!match) throw new Error(`Invalid approved Shopify ${type} ID.`);
  return match[1];
}
function targetsFromPlan(value: unknown): Target[] {
  const plan = record(value);
  const summary = record(plan.summary);
  if (summary.shop !== 'monsterthreads.myshopify.com' || summary.candidates !== 484
    || !Array.isArray(plan.candidates) || plan.candidates.length !== 484) {
    throw new Error('Expected the approved Monsterthreads preview containing exactly 484 candidates.');
  }
  const targets = plan.candidates.map((value: unknown) => {
    const candidate = record(value);
    const proposed = record(candidate.proposed);
    return {
      productId: text(candidate.productId), name: text(candidate.name), sku: text(candidate.sku),
      externalProductId: id(record(candidate.current).id, 'Product'),
      externalVariantId: id(proposed.preserveVariantId, 'ProductVariant'),
      externalInventoryId: id(proposed.preserveInventoryItemId, 'InventoryItem'),
    };
  });
  for (const key of ['productId', 'externalProductId', 'externalVariantId', 'externalInventoryId'] as const) {
    if (new Set(targets.map(target => target[key])).size !== targets.length) throw new Error(`Duplicate approved ${key}.`);
  }
  return targets;
}

async function main() {
  let business: Business | undefined, tenant: mysql.Connection | undefined;
  let auditPath: string | undefined, auditCreated = false, activeProduct: string | undefined;
  try {
    const args = process.argv.slice(2);
    if (!args.includes('--apply') || args.some(arg => !['--apply', '--canary'].includes(arg)
      && !arg.startsWith('--plan=') && !arg.startsWith('--audit='))) {
      throw new Error('Requires --apply --plan=<approved absolute JSON> --audit=<new absolute JSONL>; optional --canary.');
    }
    const planPath = args.find(arg => arg.startsWith('--plan='))?.slice(7);
    auditPath = args.find(arg => arg.startsWith('--audit='))?.slice(8);
    if (!planPath || !auditPath || !isAbsolute(planPath) || !isAbsolute(auditPath)) throw new Error('Plan and audit paths must be absolute.');
    const approved = targetsFromPlan(JSON.parse(await readFile(planPath, 'utf8')));
    const canary = args.includes('--canary');
    const targets = canary ? approved.filter((target, index) => index === 0 || target.sku === 'SS261464-ONS') : approved;
    if (canary && targets.length !== 2) throw new Error('Expected the screenshot and single-option canaries.');
    const businesses = await query<Business>(
      `SELECT business_id, ims_db_name FROM businesses
        WHERE LOWER(TRIM(name)) = LOWER(?) AND COALESCE(is_sandbox, 0) = 0`, ['Monsterthreads'],
    );
    if (businesses.length !== 1 || businesses[0].ims_db_name !== 'readyedu_MonsterthreadsIMS') {
      throw new Error('Expected the unique registered live Monsterthreads IMS schema.');
    }
    business = businesses[0];
    const instances = await query<{ channel_instance_id: string }>(
      `SELECT channel_instance_id FROM sales_channel_instances
        WHERE business_id = ? AND provider = 'shopify' AND is_enabled = 1 AND runtime_status = 'active'`, [business.business_id],
    );
    if (instances.length !== 1) throw new Error('Expected one active Monsterthreads Shopify storefront.');
    const context = await getShopifyOperationContext({ businessId: business.business_id, channelInstanceId: instances[0].channel_instance_id });
    if (context.credentials.shopDomain !== 'monsterthreads.myshopify.com') throw new Error('Unexpected Shopify storefront.');
    const service = new ShopifyService(context.credentials.shopDomain, context.credentials.token);
    tenant = await mysql.createConnection({
      host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
      database: business.ims_db_name, connectTimeout: 20_000,
    });
    await writeFile(auditPath, JSON.stringify({ type: 'approved_plan', at: new Date().toISOString(),
      shop: context.credentials.shopDomain, canary, targets }) + '\n', { flag: 'wx' });
    auditCreated = true;
    let repaired = 0, alreadySimple = 0;
    for (const target of targets) {
      activeProduct = target.productId;
      const [variants] = await tenant.execute<Variant[]>(
        `SELECT variant_id, sku, is_active, option1_name, option1_value, option2_name, option2_value, option3_name, option3_value
           FROM ims_product_variants WHERE business_id = ? AND product_id = ?`, [business.business_id, target.productId],
      );
      const [mappings] = await tenant.execute<Mapping[]>(
        `SELECT mapping.variant_id, mapping.external_product_id, mapping.external_variant_id, mapping.external_inventory_id
           FROM ims_sales_channel_product_mappings mapping
           JOIN ims_product_variants variant ON variant.variant_id = mapping.variant_id
            AND BINARY variant.business_id = BINARY mapping.business_id
          WHERE mapping.business_id = ? AND mapping.channel_instance_id = ? AND mapping.mapping_status = 'linked'
            AND (variant.product_id = ? OR mapping.external_variant_id = ? OR mapping.external_product_id = ?)`,
        [business.business_id, context.channelInstanceId, target.productId, target.externalVariantId, target.externalProductId],
      );
      const mapping = mappings[0];
      if (mappings.length !== 1 || variants.length !== 1 || variants[0].sku !== target.sku
        || mapping.external_product_id !== target.externalProductId || mapping.external_variant_id !== target.externalVariantId
        || mapping.external_inventory_id !== target.externalInventoryId) {
        throw new Error(`Approved identity or source SKU changed for ${target.name}; stopped without guessing.`);
      }
      const [before] = await service.getProductOptionsSnapshots([target.externalProductId]);
      if (!before) throw new Error(`Shopify product not found: ${target.name}.`);
      const classification = previewShopifyDefaultOptionRepair(variants, mappings, before);
      if (classification.outcome === 'review') throw new Error(`${target.name}: ${classification.reason}`);
      if (classification.outcome === 'already_simple') {
        alreadySimple++;
        await appendFile(auditPath, JSON.stringify({ type: 'already_simple', productId: target.productId, snapshot: before }) + '\n');
        continue;
      }
      await appendFile(auditPath, JSON.stringify({ type: 'attempt', target, before }) + '\n');
      await service.removeArtificialDefaultOptions(before);
      const [after] = await service.getProductOptionsSnapshots([target.externalProductId]);
      if (!after) throw new Error(`Independent product readback failed: ${target.name}.`);
      assertShopifyDefaultOptionRepairPreserved(before, after);
      repaired++;
      await appendFile(auditPath, JSON.stringify({ type: 'verified', productId: target.productId, after }) + '\n');
      if (repaired % 25 === 0 || canary) console.log(JSON.stringify({ repaired, alreadySimple, lastSku: target.sku }));
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    const summary = { approved: targets.length, repaired, alreadySimple, independentlyVerified: repaired, audit: auditPath };
    await appendFile(auditPath, JSON.stringify({ type: 'complete', ...summary }) + '\n');
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    if (auditCreated && auditPath) await appendFile(auditPath, JSON.stringify({
      type: 'failed', productId: activeProduct, message: error instanceof Error ? error.message : 'Repair failed.',
    }) + '\n');
    if (business) await reportRuntimeIssue({
      businessId: business.business_id, source: 'shopify', operation: 'default_options_repair',
      title: 'Shopify default-options repair failed', error,
      reference: { type: 'product', id: activeProduct ?? 'repair' }, deferAlert: true,
    });
    throw error;
  } finally {
    if (tenant) await tenant.end();
    await getPool().end();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message || error.name : 'Repair failed.'); process.exitCode = 1; });
