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

// Unlinked variants whose SKU starts with MT- (definitely Shopify products)
const [mtUnlinked] = await c.execute(`
  SELECT v.sku, p.name
  FROM ims_product_variants v
  JOIN ims_products p ON p.product_id = v.product_id
  WHERE v.is_active = 1
    AND v.shopify_variant_id IS NULL
    AND v.sku LIKE 'MT-%'
  ORDER BY v.sku
  LIMIT 30
`);
console.log(`\nUnlinked MT- variants (sample of up to 30):`);
for (const r of mtUnlinked) console.log(`  ${r.sku}  —  ${r.name}`);

const [[{ mtCount }]] = await c.execute(`
  SELECT COUNT(*) AS mtCount FROM ims_product_variants v
  WHERE v.is_active = 1 AND v.shopify_variant_id IS NULL AND v.sku LIKE 'MT-%'
`);
console.log(`\nTotal unlinked MT- variants: ${mtCount}`);

// Linked vs total
const [[{ linked, total }]] = await c.execute(`
  SELECT
    SUM(shopify_variant_id IS NOT NULL) AS linked,
    COUNT(*) AS total
  FROM ims_product_variants WHERE is_active = 1
`);
console.log(`\nLinked: ${linked} / ${total} active variants (${Math.round(linked/total*100)}%)`);

await c.end();
