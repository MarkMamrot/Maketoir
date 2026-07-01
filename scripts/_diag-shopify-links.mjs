import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']/, '').replace(/["']$/, '')]; })
);

const c = await mysql.createConnection({
  host: env.MYSQL_HOST, port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.IMS_MYSQL_DATABASE,
});

// 1. Check the specific SKU
const [specific] = await c.execute(`
  SELECT v.variant_id, v.sku, v.barcode, v.is_active, v.business_id,
         v.shopify_variant_id, v.shopify_inventory_item_id, p.shopify_product_id, p.name
  FROM ims_product_variants v
  JOIN ims_products p ON p.product_id = v.product_id
  WHERE v.sku = 'MT-TMRecWars-XS'
`);
console.log('\n=== MT-TMRecWars-XS variant ===');
console.log(JSON.stringify(specific, null, 2));

// 2. How many variants are excluded by is_active = 0?
const [[{ inactive }]] = await c.execute(
  `SELECT COUNT(*) AS inactive FROM ims_product_variants WHERE is_active = 0`
);
console.log(`\nInactive variants excluded from reconcile: ${inactive}`);

// 3. How many variants have null or empty business_id?
const [[{ no_biz }]] = await c.execute(
  `SELECT COUNT(*) AS no_biz FROM ims_product_variants WHERE business_id IS NULL OR business_id = ''`
);
console.log(`Variants with no business_id: ${no_biz}`);

// 4. How many active variants are UNLINKED (no shopify_variant_id)?
const [[{ unlinked }]] = await c.execute(
  `SELECT COUNT(*) AS unlinked FROM ims_product_variants WHERE is_active = 1 AND shopify_variant_id IS NULL`
);
console.log(`Active variants with no Shopify link: ${unlinked}`);

// 5. Sample of unlinked active variants with SKUs that look like Shopify SKUs
const [samples] = await c.execute(`
  SELECT v.variant_id, v.sku, v.is_active, v.business_id, p.name
  FROM ims_product_variants v
  JOIN ims_products p ON p.product_id = v.product_id
  WHERE v.is_active = 1
    AND v.shopify_variant_id IS NULL
    AND v.sku IS NOT NULL
  ORDER BY v.sku
  LIMIT 20
`);
console.log('\nSample unlinked active variants:');
for (const r of samples) console.log(JSON.stringify(r));

// 6. Are variants linked but product is not? (orphan)
const [[{ orphan }]] = await c.execute(`
  SELECT COUNT(*) AS orphan
  FROM ims_product_variants v
  JOIN ims_products p ON p.product_id = v.product_id
  WHERE v.shopify_variant_id IS NOT NULL
    AND p.shopify_product_id IS NULL
`);
console.log(`\nVariants linked but product NOT linked: ${orphan}`);

// 7. Products with no shopify link but has variants with shopify links
const [[{ totProducts }]] = await c.execute(
  `SELECT COUNT(*) AS totProducts FROM ims_products WHERE is_active = 1 AND shopify_product_id IS NULL`
);
console.log(`Active products without Shopify link: ${totProducts}`);

await c.end();
