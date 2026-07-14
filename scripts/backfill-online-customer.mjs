/**
 * One-time backfill: attribute all existing online orders to a default
 * "Online Customer" contact (per business), and cache its id in the
 * `online_sales_customer_id` setting. Idempotent — safe to re-run.
 *
 *   node scripts/backfill-online-customer.mjs
 */
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]/, '').replace(/['"]$/, '')]; })
);

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST, port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.IMS_MYSQL_DATABASE,
});

// Every business that has online orders.
const [businesses] = await conn.execute(
  `SELECT DISTINCT business_id FROM ims_sales_orders WHERE so_type = 'online' AND business_id IS NOT NULL`
);

for (const { business_id } of businesses) {
  // Find or create the "Online Customer" contact.
  const [found] = await conn.execute(
    `SELECT id FROM ims_contacts WHERE business_id = ? AND name = 'Online Customer' ORDER BY id LIMIT 1`,
    [business_id]
  );
  let customerId;
  if (found[0]) {
    customerId = found[0].id;
  } else {
    const [res] = await conn.execute(
      `INSERT INTO ims_contacts (business_id, type, name, is_active) VALUES (?, 'customer', 'Online Customer', 1)`,
      [business_id]
    );
    customerId = res.insertId;
  }

  // Cache the id in settings.
  await conn.execute(
    'INSERT INTO ims_settings (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [business_id, 'online_sales_customer_id', String(customerId)]
  );

  // Backfill online orders with no customer.
  const [upd] = await conn.execute(
    `UPDATE ims_sales_orders SET customer_id = ?
      WHERE business_id = ? AND so_type = 'online' AND (customer_id IS NULL OR customer_id = 0)`,
    [customerId, business_id]
  );
  console.log(`business ${business_id}: Online Customer id=${customerId}, ${upd.affectedRows} order(s) backfilled`);
}

await conn.end();
