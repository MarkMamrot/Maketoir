import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: 'thomas.proxy.rlwy.net',
  port: 15319,
  user: 'root',
  password: 'wzRIeQOychDJMpfnXsyEOHPyHmFEkZcH',
  database: 'readyedu_MonsterthreadsIMS',
  ssl: { rejectUnauthorized: false },
});

const steps = [
  ['ims_stock',                 'DELETE FROM ims_stock'],
  ['ims_stock_movements',       'DELETE FROM ims_stock_movements WHERE variant_id IS NOT NULL'],
  ['ims_purchase_order_items',  'UPDATE ims_purchase_order_items SET variant_id = NULL WHERE variant_id IS NOT NULL'],
  ['ims_sales_order_items',     'UPDATE ims_sales_order_items SET variant_id = NULL WHERE variant_id IS NOT NULL'],
  ['pos_sale_items',            'DELETE FROM pos_sale_items WHERE variant_id IS NOT NULL'],
  ['ims_product_variants',      'DELETE FROM ims_product_variants'],
  ['ims_products',              'DELETE FROM ims_products'],
  ['ims_settings sync stamp',   "DELETE FROM ims_settings WHERE `key` = 'last_products_sync'"],
];

for (const [label, sql] of steps) {
  const [res] = await conn.execute(sql);
  console.log(`${label}: ${res.affectedRows} rows affected`);
}

await conn.end();
console.log('\nDone — database is clean. Run Full Sync in IMS Settings to re-import from Cin7.');
