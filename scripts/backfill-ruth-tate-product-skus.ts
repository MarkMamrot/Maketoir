/**
 * Dry run: npx --no-install tsx scripts/backfill-ruth-tate-product-skus.ts
 * Apply: add --apply --audit=<absolute JSON audit path>.
 * Only blank parent SKUs in the uniquely resolved live Ruth Tate tenant are filled.
 */
import dotenv from 'dotenv';
import mysql, { type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createMissingShopifyProductSku, type ProductSkuVariant } from '../src/lib/ims/shopifyProductSku';

dotenv.config({ quiet: true });

interface Business extends RowDataPacket { business_id: string; name: string; ims_db_name: string }
interface Product extends RowDataPacket { product_id: string; name: string; brand: string | null; base_sku: string | null }
interface Variant extends RowDataPacket, ProductSkuVariant { product_id: string }

const apply = process.argv.includes('--apply');
const auditPath = process.argv.find(argument => argument.startsWith('--audit='))?.slice(8);
if (apply && (!auditPath || !isAbsolute(auditPath))) throw new Error('Apply requires an absolute --audit path.');
const config = {
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, connectTimeout: 20_000,
};

async function main() {
  const mainDb = await mysql.createConnection({ ...config, database: process.env.MYSQL_DATABASE });
  let tenantDb: mysql.Connection | undefined;
  try {
    const [businesses] = await mainDb.execute<Business[]>(
      `SELECT business_id, name, ims_db_name FROM businesses
        WHERE LOWER(TRIM(name)) = LOWER(?) AND COALESCE(is_sandbox, 0) = 0`, ['Ruth Tate'],
    );
    if (businesses.length !== 1 || !businesses[0].ims_db_name) throw new Error('Expected exactly one live Ruth Tate tenant with a registered IMS schema.');
    const business = businesses[0];
    tenantDb = await mysql.createConnection({ ...config, database: business.ims_db_name });
    await tenantDb.beginTransaction();
    const [products] = await tenantDb.execute<Product[]>(
      'SELECT product_id, name, brand, base_sku FROM ims_products WHERE business_id = ? ORDER BY product_id FOR UPDATE',
      [business.business_id],
    );
    const [variants] = await tenantDb.execute<Variant[]>(
      'SELECT product_id, sku, option1_value, option2_value, option3_value FROM ims_product_variants WHERE business_id = ?',
      [business.business_id],
    );
    const usedSkus = new Set(products.map(product => product.base_sku?.trim().toLowerCase()).filter((sku): sku is string => Boolean(sku)));
    const plan = products.filter(product => !product.base_sku?.trim()).map(product => ({
      productId: product.product_id, name: product.name, previousSku: product.base_sku,
      ...createMissingShopifyProductSku(product.brand, variants.filter(variant => variant.product_id === product.product_id), usedSkus),
    }));
    console.log(JSON.stringify({ business: business.name, mode: apply ? 'apply' : 'preview', totalProducts: products.length,
      blankProductSkus: plan.length, inferred: plan.filter(row => row.inferred).length,
      generated: plan.filter(row => !row.inferred).length,
      example: plan.find(row => row.productId === 'a4700b2e-32c2-45dc-a6f6-f8b2c7240585') }, null, 2));
    if (!apply) { await tenantDb.rollback(); return; }
    await writeFile(auditPath!, JSON.stringify({ business: business.name, createdAt: new Date().toISOString(), plan }, null, 2), { flag: 'wx' });
    for (const row of plan) {
      const [result] = await tenantDb.execute<ResultSetHeader>(
        `UPDATE ims_products SET base_sku = ? WHERE business_id = ? AND product_id = ?
          AND (base_sku IS NULL OR TRIM(base_sku) = '')`,
        [row.sku, business.business_id, row.productId],
      );
      if (result.affectedRows !== 1) throw new Error('A parent SKU changed during repair; all changes will be rolled back.');
    }
    const [remaining] = await tenantDb.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM ims_products WHERE business_id = ? AND (base_sku IS NULL OR TRIM(base_sku) = '')`,
      [business.business_id],
    );
    if (Number(remaining[0].count) !== 0) throw new Error('Blank parent SKUs remain; all changes will be rolled back.');
    await tenantDb.commit();
    console.log(`Verified and committed ${plan.length} blank-only Product SKU updates. Variant SKUs and stock were not changed.`);
  } catch (error) {
    if (tenantDb) await tenantDb.rollback();
    throw error;
  } finally {
    if (tenantDb) await tenantDb.end();
    await mainDb.end();
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Product SKU repair failed.'); process.exitCode = 1; });
