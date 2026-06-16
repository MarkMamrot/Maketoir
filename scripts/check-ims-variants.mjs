import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

import mysql from 'mysql2/promise';

const ims = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT,
  database: process.env.IMS_MYSQL_DATABASE,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});

const [[nullSku]] = await ims.execute('SELECT COUNT(*) as c FROM ims_product_variants WHERE sku IS NULL OR sku = ""');
console.log('Variants with null/empty SKU:', nullSku.c);

const [[withSku]] = await ims.execute('SELECT COUNT(*) as c FROM ims_product_variants WHERE sku IS NOT NULL AND sku != ""');
console.log('Variants with SKU (matchable):', withSku.c);

const [hotProd] = await ims.execute('SELECT p.product_id, p.name, p.cin7_product_id FROM ims_products p WHERE p.name LIKE ?', ['%Hot Dog%']);
console.log('\nIMS products matching "Hot Dog":', hotProd.length);
for (const p of hotProd) {
  const [vars] = await ims.execute('SELECT sku, cin7_option_id FROM ims_product_variants WHERE product_id = ?', [p.product_id]);
  console.log(' ', p.name, '| cin7_id:', p.cin7_product_id, '| variants:', vars.map(v => v.sku));
}

// Sample of variants with null SKU — what products are they from?
const [nullSkuSamples] = await ims.execute(
  'SELECT pv.cin7_option_id, p.name, p.cin7_product_id FROM ims_product_variants pv JOIN ims_products p ON p.product_id = pv.product_id WHERE pv.sku IS NULL LIMIT 10'
);
console.log('\nSample variants with null SKU:');
for (const v of nullSkuSamples) console.log(' cin7_opt:', v.cin7_option_id, '| product:', v.name);

await ims.end();
