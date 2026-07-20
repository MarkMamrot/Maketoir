import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.IMS_MYSQL_HOST ?? process.env.MYSQL_HOST,
  port: Number(process.env.IMS_MYSQL_PORT ?? process.env.MYSQL_PORT ?? 3306),
  user: process.env.IMS_MYSQL_USER ?? process.env.MYSQL_USER,
  password: process.env.IMS_MYSQL_PASSWORD ?? process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE ?? process.env.MYSQL_DATABASE,
});

async function ensureColumn(name, ddl) {
  if (!/^[a-z_]+$/i.test(name)) throw new Error(`Invalid column name: ${name}`);
  const [rows] = await conn.query(`SHOW COLUMNS FROM ims_sales_orders LIKE '${name}'`);
  if (rows.length === 0) await conn.execute(ddl);
}

await ensureColumn('price_tier', "ALTER TABLE ims_sales_orders ADD COLUMN price_tier ENUM('retail','wholesale') NOT NULL DEFAULT 'retail' AFTER customer_id");
await ensureColumn('tax_treatment', "ALTER TABLE ims_sales_orders ADD COLUMN tax_treatment ENUM('ex_tax','inc_tax','no_tax') NOT NULL DEFAULT 'ex_tax' AFTER notes");
await ensureColumn('so_type', "ALTER TABLE ims_sales_orders ADD COLUMN so_type VARCHAR(10) NOT NULL DEFAULT 'b2b'");

const [orders] = await conn.execute(`
  SELECT so.id, so.so_number, so.freight, so.discount, so.so_type, so.price_tier, so.tax_treatment,
         c.name AS customer_name
    FROM ims_sales_orders so
    LEFT JOIN ims_contacts c ON c.id = so.customer_id
   WHERE so.so_type = 'online'
      OR (so.cin7_order_id IS NOT NULL AND so.shopify_order_id IS NULL AND LOWER(c.name) = 'online shop sales')
   ORDER BY so.id
`);

let updated = 0;
let totalBefore = 0;
let totalAfter = 0;

for (const order of orders) {
  const [items] = await conn.execute(
    'SELECT line_total, tax_rate FROM ims_sales_order_items WHERE so_id = ?',
    [order.id],
  );
  if (items.length === 0) continue;

  let subtotal = 0;
  let taxAmount = 0;
  let lineIncTotal = 0;
  for (const item of items) {
    const line = Number(item.line_total || 0);
    const rate = Number(item.tax_rate || 0);
    lineIncTotal += line;
    if (rate > 0) {
      const exTax = line / (1 + rate);
      subtotal += Math.round(exTax * 100) / 100;
      taxAmount += Math.round((line - exTax) * 100) / 100;
    } else {
      subtotal += line;
    }
  }

  subtotal = Math.round(subtotal * 100) / 100;
  taxAmount = Math.round(taxAmount * 100) / 100;
  const freight = Number(order.freight || 0);
  const discount = Number(order.discount || 0);
  const totalAmount = Math.round((subtotal + taxAmount + freight - discount) * 100) / 100;

  const needsUpdate = order.so_type !== 'online'
    || order.price_tier !== 'retail'
    || order.tax_treatment !== 'inc_tax'
    || true;

  if (!needsUpdate) continue;
  await conn.execute(
    `UPDATE ims_sales_orders
        SET so_type = 'online',
            price_tier = 'retail',
            tax_treatment = 'inc_tax',
            subtotal = ?,
            tax_amount = ?,
            total_amount = ?,
            is_historical = CASE WHEN cin7_order_id IS NOT NULL AND shopify_order_id IS NULL THEN 1 ELSE is_historical END
      WHERE id = ?`,
    [subtotal, taxAmount, totalAmount, order.id],
  );
  updated += 1;
  totalBefore += lineIncTotal;
  totalAfter += totalAmount;
  console.log(`${order.so_number}: ${order.customer_name || ''} -> online retail inc-tax, total ${totalAmount.toFixed(2)}`);
}

console.log(`Updated ${updated} online retail sales orders.`);
console.log(`Line total basis: ${totalBefore.toFixed(2)}; updated order total basis: ${totalAfter.toFixed(2)}`);
await conn.end();
