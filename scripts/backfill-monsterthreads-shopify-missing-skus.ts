/**
 * Preview: npx --no-install tsx scripts\backfill-monsterthreads-shopify-missing-skus.ts
 * Apply: add --apply --shop=<previewed permanent domain> --audit=<absolute JSONL path>
 * Scans all Shopify variants, including archived/draft products. Only blank SKUs
 * with one exact, current storefront mapping and a nonblank IMS SKU are filled.
 * No local catalogue, barcode, price, publication or quantity writes.
 */
import dotenv from 'dotenv';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { appendFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { getPool, query } from '../src/services/MySQLService';
import { getShopifyOperationContext } from '../src/lib/channels/shopifyOperationContext';
import { ShopifyService, type ShopifySkuVariant } from '../src/services/ShopifyService';
import { reportRuntimeIssue } from '../src/lib/runtimeIssues';

dotenv.config({ quiet: true });

interface Business { business_id: string; name: string; ims_db_name: string }
interface Mapping extends RowDataPacket {
  variant_id: string; external_product_id: string; external_variant_id: string; sku: string | null;
}
const apply = process.argv.includes('--apply');
const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const auditPath = argument('audit');
const expectedShop = argument('shop');
const numericId = (gid: string) => gid.slice(gid.lastIndexOf('/') + 1);
const blank = (value: string | null) => !value?.trim();
const sleep = () => new Promise(resolve => setTimeout(resolve, 350));

async function main() {
  if (apply && (!auditPath || !isAbsolute(auditPath) || !expectedShop)) {
    throw new Error('Apply requires --shop=<previewed domain> and an absolute --audit=<new JSONL path>.');
  }
  let business: Business | undefined;
  let tenant: mysql.Connection | undefined;
  try {
    const businesses = await query<Business>(
      `SELECT business_id, name, ims_db_name FROM businesses
        WHERE LOWER(TRIM(name)) = LOWER(?) AND COALESCE(is_sandbox, 0) = 0`, ['Monsterthreads'],
    );
    if (businesses.length !== 1 || businesses[0].ims_db_name !== 'readyedu_MonsterthreadsIMS') {
      throw new Error('Expected exactly one live Monsterthreads business with its registered IMS schema.');
    }
    business = businesses[0];
    const instances = await query<{ channel_instance_id: string }>(
      `SELECT channel_instance_id FROM sales_channel_instances
        WHERE business_id = ? AND provider = 'shopify' AND is_enabled = 1 AND runtime_status = 'active'`,
      [business.business_id],
    );
    if (instances.length !== 1) throw new Error('Expected exactly one active Monsterthreads Shopify storefront.');
    const context = await getShopifyOperationContext({
      businessId: business.business_id, channelInstanceId: instances[0].channel_instance_id,
    });
    if (expectedShop && expectedShop !== context.credentials.shopDomain) throw new Error('Shopify domain does not match --shop.');
    const service = new ShopifyService(context.credentials.shopDomain, context.credentials.token);
    tenant = await mysql.createConnection({
      host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
      database: business.ims_db_name, connectTimeout: 20_000,
    });
    const mappingSql = `SELECT mapping.variant_id, mapping.external_product_id, mapping.external_variant_id, variant.sku
      FROM ims_sales_channel_product_mappings mapping
      JOIN ims_product_variants variant
        ON BINARY variant.business_id = BINARY mapping.business_id AND variant.variant_id = mapping.variant_id
      WHERE mapping.business_id = ? AND mapping.channel_instance_id = ? AND mapping.mapping_status = 'linked'`;
    const mappingParams = [business.business_id, context.channelInstanceId];
    const [mappings] = await tenant.execute<Mapping[]>(mappingSql, mappingParams);
    const byVariant = new Map<string, Mapping[]>();
    for (const mapping of mappings) {
      const id = String(mapping.external_variant_id);
      byVariant.set(id, [...(byVariant.get(id) ?? []), mapping]);
    }
    const plan: Array<{ variantId: string; productId: string; localVariantId: string; sku: string }> = [];
    const skipped: Array<{ variantId: string; reason: string }> = [];
    let scanned = 0, missing = 0, cursor: string | null = null;
    do {
      const page = await service.getSkuVariantsPage(cursor);
      scanned += page.nodes.length;
      for (const remote of page.nodes) {
        if (!blank(remote.sku) || !blank(remote.inventoryItem.sku)) continue;
        missing++;
        const variantId = numericId(remote.id);
        const matches = byVariant.get(variantId) ?? [];
        const mapping = matches[0];
        if (matches.length !== 1 || String(mapping.external_product_id) !== numericId(remote.product.id) || blank(mapping.sku)) {
          skipped.push({ variantId, reason: matches.length !== 1 ? 'No unique exact mapping'
            : blank(mapping.sku) ? 'IMS SKU is blank' : 'Product ownership mismatch' });
          continue;
        }
        plan.push({ variantId, productId: numericId(remote.product.id), localVariantId: mapping.variant_id, sku: mapping.sku! });
      }
      if (!page.pageInfo.hasNextPage) break;
      if (!page.pageInfo.endCursor || page.pageInfo.endCursor === cursor) throw new Error('Shopify pagination did not advance.');
      cursor = page.pageInfo.endCursor;
      await sleep();
    } while (true);
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', shop: context.credentials.shopDomain,
      scanned, missing, eligible: plan.length, skipped: skipped.length, examples: plan.slice(0, 10),
      skippedExamples: skipped.slice(0, 10) }, null, 2));
    if (!apply) return;
    await writeFile(auditPath!, JSON.stringify({ type: 'plan', at: new Date().toISOString(),
      shop: context.credentials.shopDomain, scanned, missing, plan, skipped }) + '\n', { flag: 'wx' });
    let updated = 0, changedSincePreview = 0;
    for (const row of plan) {
      const [currentMappings] = await tenant.execute<Mapping[]>(
        `${mappingSql} AND mapping.external_variant_id = ?`, [...mappingParams, row.variantId],
      );
      const current = currentMappings[0];
      if (currentMappings.length !== 1 || current.variant_id !== row.localVariantId
        || current.sku !== row.sku || String(current.external_product_id) !== row.productId) {
        throw new Error(`Mapping or source SKU changed for Shopify variant ${row.variantId}; rerun preview.`);
      }
      const [remote] = await service.getSkuVariants([row.variantId]);
      if (!remote || numericId(remote.product.id) !== row.productId) throw new Error(`Variant ${row.variantId} ownership changed.`);
      if (!blank(remote.sku) || !blank(remote.inventoryItem.sku)) {
        changedSincePreview++;
        await appendFile(auditPath!, JSON.stringify({ type: 'skipped_nonblank', variantId: row.variantId }) + '\n');
        continue;
      }
      await appendFile(auditPath!, JSON.stringify({ type: 'attempt', ...row }) + '\n');
      await service.syncVariantSkus(row.productId, [{ id: row.variantId, sku: row.sku }]);
      const [verified] = await service.getSkuVariants([row.variantId]);
      if (!verified || verified.sku !== row.sku || verified.inventoryItem.sku !== row.sku) {
        throw new Error(`Independent readback failed for variant ${row.variantId}.`);
      }
      updated++;
      await appendFile(auditPath!, JSON.stringify({ type: 'verified', ...row }) + '\n');
      await sleep();
    }
    console.log(JSON.stringify({ updated, independentlyVerified: updated, changedSincePreview,
      unresolved: skipped.length, audit: auditPath }, null, 2));
    if (skipped.length) process.exitCode = 2;
  } catch (error) {
    if (business) await reportRuntimeIssue({
      businessId: business.business_id, source: 'shopify', operation: 'missing_sku_repair',
      title: 'Monsterthreads missing Shopify SKU repair failed', error,
      context: { mode: apply ? 'apply' : 'preview' },
      reference: { type: 'business', id: business.business_id }, deferAlert: true,
    });
    throw error;
  } finally {
    if (tenant) await tenant.end();
    await getPool().end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Shopify SKU repair failed.');
  process.exitCode = 1;
});
