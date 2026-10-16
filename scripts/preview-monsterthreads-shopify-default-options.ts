/**
 * Read-only preview; this script has no apply mode and performs no Shopify mutations.
 * npx --no-install tsx scripts\preview-monsterthreads-shopify-default-options.ts
 * Add --audit=<new absolute JSON path> to save the complete plan.
 */
import 'dotenv/config';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { getPool, query } from '../src/services/MySQLService';
import { getShopifyOperationContext } from '../src/lib/channels/shopifyOperationContext';
import { ShopifyService } from '../src/services/ShopifyService';
import { reportRuntimeIssue } from '../src/lib/runtimeIssues';
import {
  isSimpleShopifyProduct, previewShopifyDefaultOptionRepair,
  type ShopifyOptionVariant, type ShopifyDefaultOptionMapping, type ShopifyProductOptionsSnapshot,
} from '../src/lib/ims/shopifyProductOptions';

interface Business { business_id: string; ims_db_name: string }
interface Variant extends RowDataPacket, ShopifyOptionVariant {
  product_id: string; product_name: string; variant_id: string; sku: string | null; is_active: number;
}
interface Mapping extends RowDataPacket, ShopifyDefaultOptionMapping { product_id: string }

async function main() {
  let business: Business | undefined;
  let tenant: mysql.Connection | undefined;
  try {
    if (process.argv.some(argument => argument !== '--audit' && argument.startsWith('--')
      && !argument.startsWith('--audit='))) {
      throw new Error('This is a read-only preview. Only --audit=<absolute JSON path> is supported; there is no apply mode.');
    }
    const auditPath = process.argv.find(argument => argument.startsWith('--audit='))?.slice(8);
    if (process.argv.includes('--audit') || (auditPath !== undefined && (!auditPath || !isAbsolute(auditPath)))) {
      throw new Error('Use --audit=<new absolute JSON path>.');
    }
    const businesses = await query<Business>(
      `SELECT business_id, ims_db_name FROM businesses
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
    const service = new ShopifyService(context.credentials.shopDomain, context.credentials.token);
    tenant = await mysql.createConnection({
      host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
      database: business.ims_db_name, connectTimeout: 20_000,
    });
    const [variants] = await tenant.execute<Variant[]>(
      `SELECT variant.product_id, product.name AS product_name, variant.variant_id, variant.sku, variant.is_active,
              variant.option1_name, variant.option1_value, variant.option2_name, variant.option2_value,
              variant.option3_name, variant.option3_value
         FROM ims_product_variants variant
         JOIN ims_products product ON product.product_id = variant.product_id
          AND BINARY product.business_id = BINARY variant.business_id
        WHERE variant.business_id = ? ORDER BY product.product_id, variant.variant_id`, [business.business_id],
    );
    const [mappings] = await tenant.execute<Mapping[]>(
      `SELECT variant.product_id, mapping.variant_id, mapping.external_product_id,
              mapping.external_variant_id, mapping.external_inventory_id
         FROM ims_sales_channel_product_mappings mapping
         JOIN ims_product_variants variant ON variant.variant_id = mapping.variant_id
          AND BINARY variant.business_id = BINARY mapping.business_id
        WHERE mapping.business_id = ? AND mapping.channel_instance_id = ? AND mapping.mapping_status = 'linked'`,
      [business.business_id, context.channelInstanceId],
    );
    const byProduct = new Map<string, Variant[]>();
    const mappingsByProduct = new Map<string, Mapping[]>();
    const externalVariantCounts = new Map<string, number>();
    for (const variant of variants) byProduct.set(variant.product_id, [...(byProduct.get(variant.product_id) ?? []), variant]);
    for (const mapping of mappings) {
      mappingsByProduct.set(mapping.product_id, [...(mappingsByProduct.get(mapping.product_id) ?? []), mapping]);
      externalVariantCounts.set(mapping.external_variant_id, (externalVariantCounts.get(mapping.external_variant_id) ?? 0) + 1);
    }
    const localSimpleProducts = [...byProduct.values()].filter(rows => isSimpleShopifyProduct(rows) && rows[0].is_active === 1);
    const productIds = [...new Set(localSimpleProducts.flatMap(rows =>
      (mappingsByProduct.get(rows[0].product_id) ?? []).map(mapping => mapping.external_product_id)))];
    const remoteById = new Map<string, ShopifyProductOptionsSnapshot>();
    for (let offset = 0; offset < productIds.length; offset += 40) {
      const page = await service.getProductOptionsSnapshots(productIds.slice(offset, offset + 40));
      for (const product of page) if (product) remoteById.set(product.id, product);
      if (offset + 40 < productIds.length) await new Promise(resolve => setTimeout(resolve, 350));
    }
    const candidates: Array<{
      productId: string; name: string; sku: string | null; current: ShopifyProductOptionsSnapshot;
      proposed: { options: Array<{ name: string; values: string[] }>; preserveVariantId: string; preserveInventoryItemId: string };
    }> = [];
    const review: Array<{ productId: string; name: string; reason: string }> = [];
    let alreadySimple = 0, notMapped = 0;
    for (const rows of localSimpleProducts) {
      const local = rows[0];
      const links = mappingsByProduct.get(local.product_id) ?? [];
      if (!links.length) { notMapped++; continue; }
      const remote = remoteById.get(`gid://shopify/Product/${links[0].external_product_id}`);
      if (!remote) {
        review.push({ productId: local.product_id, name: local.product_name, reason: 'Mapped Shopify product was not found.' });
        continue;
      }
      if (links.some(link => externalVariantCounts.get(link.external_variant_id) !== 1)) {
        review.push({ productId: local.product_id, name: local.product_name, reason: 'Shopify variant is mapped more than once.' });
        continue;
      }
      const result = previewShopifyDefaultOptionRepair(rows, links, remote);
      if (result.outcome === 'already_simple') alreadySimple++;
      else if (result.outcome === 'review') review.push({ productId: local.product_id, name: local.product_name, reason: result.reason });
      else candidates.push({
        productId: local.product_id, name: local.product_name, sku: local.sku, current: remote,
        proposed: { options: [{ name: 'Title', values: ['Default Title'] }],
          preserveVariantId: remote.variants.nodes[0].id, preserveInventoryItemId: remote.variants.nodes[0].inventoryItem.id },
      });
    }
    const summary = {
      mode: 'read-only preview', shop: context.credentials.shopDomain, localSimpleProducts: localSimpleProducts.length,
      candidates: candidates.length, alreadySimple, notMapped, review: review.length,
    };
    if (auditPath) await writeFile(auditPath, JSON.stringify({
      createdAt: new Date().toISOString(), summary, candidates, review,
    }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ ...summary,
      screenshotExample: candidates.find(candidate => candidate.sku === 'SS261464-ONS'),
      examples: candidates.slice(0, 5).map(candidate => ({
        name: candidate.name, sku: candidate.sku, options: candidate.current.options, proposed: candidate.proposed,
      })), reviewExamples: review.slice(0, 5), audit: auditPath,
    }, null, 2));
  } catch (error) {
    if (business) await reportRuntimeIssue({
      businessId: business.business_id, source: 'shopify', operation: 'default_options_preview',
      title: 'Shopify default-options repair preview failed', error,
      reference: { type: 'business', id: business.business_id }, deferAlert: true,
    });
    throw error;
  } finally {
    if (tenant) await tenant.end();
    await getPool().end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message || error.name : 'Shopify default-options preview failed.');
  process.exitCode = 1;
});
