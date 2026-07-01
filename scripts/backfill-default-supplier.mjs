/**
 * Backfill ims_products.supplier_contact_id from the most recent PO per product.
 *
 * For every product that has ever appeared on a purchase order, find the PO with
 * the latest order_date (any status) and copy that supplier_id into
 * ims_products.supplier_contact_id — but ONLY when the field is currently NULL,
 * so manually-set values are never overwritten.
 *
 * Run once:  node scripts/backfill-default-supplier.mjs
 * Safe to re-run — only touches rows where supplier_contact_id IS NULL.
 */

import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']/, '').replace(/["']$/, '')];
    })
);

const conn = await mysql.createConnection({
  host:           env.MYSQL_HOST,
  port:           parseInt(env.MYSQL_PORT || '3306'),
  user:           env.MYSQL_USER,
  password:       env.MYSQL_PASSWORD,
  database:       env.IMS_MYSQL_DATABASE,
  connectTimeout: 20000,
});

console.log('Connected to', env.IMS_MYSQL_DATABASE);

// Find the most-recent PO supplier for each product (via variants → po_items → po)
const [rows] = await conn.execute(`
  SELECT p.product_id,
         po.supplier_id AS contact_id,
         c.name         AS supplier_name
  FROM ims_products p
  -- join to best PO for this product
  JOIN (
    SELECT v2.product_id,
           po2.supplier_id,
           MAX(COALESCE(po2.order_date, po2.created_at)) AS latest_date
    FROM ims_product_variants v2
    JOIN ims_purchase_order_items poi2 ON poi2.variant_id = v2.variant_id
    JOIN ims_purchase_orders       po2  ON po2.id = poi2.po_id
    WHERE po2.supplier_id IS NOT NULL
    GROUP BY v2.product_id, po2.supplier_id
  ) best ON best.product_id = p.product_id
  -- ensure we take only the single most-recent supplier per product
  JOIN ims_purchase_orders po ON po.supplier_id = best.supplier_id
  JOIN ims_product_variants v  ON v.product_id  = p.product_id
  JOIN ims_purchase_order_items poi ON poi.variant_id = v.variant_id AND poi.po_id = po.id
  LEFT JOIN ims_contacts c ON c.id = po.supplier_id
  WHERE p.supplier_contact_id IS NULL
  GROUP BY p.product_id, po.supplier_id, c.name
  ORDER BY MAX(COALESCE(po.order_date, po.created_at)) DESC
`);

if (rows.length === 0) {
  console.log('ℹ️  No products with NULL supplier_contact_id found — nothing to do.');
  await conn.end();
  process.exit(0);
}

// Deduplicate — keep only the best (latest) supplier per product_id
const seen = new Map();
for (const row of rows) {
  if (!seen.has(row.product_id)) seen.set(row.product_id, row);
}

const toUpdate = [...seen.values()];
console.log(`Found ${toUpdate.length} product(s) to backfill.`);

let updated = 0;
for (const { product_id, contact_id, supplier_name } of toUpdate) {
  await conn.execute(
    `UPDATE ims_products SET supplier_contact_id = ? WHERE product_id = ? AND supplier_contact_id IS NULL`,
    [contact_id, product_id]
  );
  console.log(`  ✅  ${product_id}  →  ${supplier_name ?? contact_id}`);
  updated++;
}

console.log(`\nDone. ${updated} product(s) updated.`);

const [nullRows] = await conn.execute(
  `SELECT COUNT(*) AS cnt FROM ims_products WHERE supplier_contact_id IS NULL`
);
console.log(`${nullRows[0].cnt} product(s) still have no default supplier (no PO history).`);

await conn.end();
