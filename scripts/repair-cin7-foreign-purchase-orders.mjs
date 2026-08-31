import 'dotenv/config';
import mysql from 'mysql2/promise';

const APPLY = process.argv.includes('--apply');
const CONFIRM = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const CONFIRM_TOKEN = 'CIN7-FOREIGN-PO-BACKFILL';
const REPAIR_MARKER_KEY = 'cin7_foreign_po_currency_backfill_v1';

if (APPLY && CONFIRM !== CONFIRM_TOKEN) {
  console.error(`Apply mode requires --confirm=${CONFIRM_TOKEN}`);
  process.exit(1);
}

const mainConfig = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
};

const imsConfig = {
  host: process.env.IMS_MYSQL_HOST || process.env.MYSQL_HOST,
  port: Number(process.env.IMS_MYSQL_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.IMS_MYSQL_USER || process.env.MYSQL_USER,
  password: process.env.IMS_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD,
};

function assertSchemaName(schema) {
  if (!/^[A-Za-z0-9_]+$/.test(schema)) throw new Error(`Unsafe IMS schema name: ${schema}`);
}

const main = await mysql.createConnection(mainConfig);
const [businesses] = await main.execute(
  `SELECT business_id, name, ims_db_name
     FROM businesses
    WHERE deleted_at IS NULL
      AND ims_db_name IS NOT NULL
      AND ims_db_name <> ''
    ORDER BY name`,
);
await main.end();

let totalOrders = 0;
let totalItems = 0;
let totalBlocked = 0;

console.log(APPLY ? 'APPLY MODE' : 'DRY RUN');

for (const business of businesses) {
  assertSchemaName(business.ims_db_name);
  const connection = await mysql.createConnection({ ...imsConfig, database: business.ims_db_name });
  try {
    const [markerRows] = await connection.execute(
      'SELECT value FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1',
      [business.business_id, REPAIR_MARKER_KEY],
    );
    if (markerRows.length > 0) {
      console.log(`${business.name}: already repaired at ${markerRows[0].value}; skipped`);
      continue;
    }

    const [orders] = await connection.execute(
      `SELECT po.id, po.po_number, po.currency_code, po.exchange_rate,
              po.subtotal, po.tax_amount, po.freight, po.discount, po.total_amount,
              po.xero_bill_id,
              (SELECT COUNT(*) FROM ims_purchase_order_payments payment WHERE payment.po_id = po.id) AS payment_count,
              (SELECT COALESCE(SUM(item.qty_received), 0) FROM ims_purchase_order_items item WHERE item.po_id = po.id) AS received_quantity
         FROM ims_purchase_orders po
        WHERE po.cin7_order_id IS NOT NULL
          AND UPPER(po.currency_code) <> 'AUD'
        ORDER BY po.id`,
    );

    const blocked = orders.filter((order) => order.xero_bill_id || Number(order.payment_count) > 0 || Number(order.received_quantity) > 0);
    const eligible = orders.filter((order) => !order.xero_bill_id && Number(order.payment_count) === 0 && Number(order.received_quantity) === 0);
    const orderIds = eligible.map((order) => Number(order.id));
    let itemCount = 0;

    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => '?').join(',');
      const [itemRows] = await connection.execute(
        `SELECT COUNT(*) AS count FROM ims_purchase_order_items WHERE po_id IN (${placeholders})`,
        orderIds,
      );
      itemCount = Number(itemRows[0]?.count ?? 0);
    }

    totalOrders += eligible.length;
    totalItems += itemCount;
    totalBlocked += blocked.length;

    console.log(`${business.name}: ${eligible.length} PO(s), ${itemCount} item(s), ${blocked.length} blocked`);
    for (const order of eligible.filter((row) => row.po_number === 'PO-908264')) {
      const cin7Rate = Number(order.exchange_rate);
      console.log(`  PO-908264: AUD ${Number(order.total_amount).toFixed(2)} -> USD ${(Number(order.total_amount) * cin7Rate).toFixed(2)} @ ${(1 / cin7Rate).toFixed(6)} AUD/USD; tax -> 0.00`);
    }

    if (!APPLY || eligible.length === 0) continue;

    await connection.beginTransaction();
    try {
      for (const order of eligible) {
        const cin7Rate = Number(order.exchange_rate);
        if (!Number.isFinite(cin7Rate) || cin7Rate <= 0) {
          throw new Error(`${order.po_number} has invalid Cin7 currency rate ${order.exchange_rate}`);
        }
        const audPerForeign = 1 / cin7Rate;
        await connection.execute(
          `UPDATE ims_purchase_order_items
              SET unit_cost = unit_cost * ?,
                  line_total = line_total * ?,
                  tax_rate = 0
            WHERE po_id = ?`,
          [cin7Rate, cin7Rate, order.id],
        );
        await connection.execute(
          `UPDATE ims_purchase_orders
              SET subtotal = subtotal * ?,
                  tax_amount = 0,
                  freight = freight * ?,
                  discount = discount * ?,
                  total_amount = total_amount * ?,
                  exchange_rate = ?,
                  tax_treatment = 'no_tax',
                  tax_code = NULL
            WHERE id = ?
              AND cin7_order_id IS NOT NULL
              AND UPPER(currency_code) <> 'AUD'`,
          [cin7Rate, cin7Rate, cin7Rate, cin7Rate, audPerForeign, order.id],
        );
      }
      await connection.execute(
        `INSERT INTO ims_settings (business_id, \`key\`, value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [business.business_id, REPAIR_MARKER_KEY, new Date().toISOString()],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    await connection.end();
  }
}

console.log(`${APPLY ? 'Repaired' : 'Would repair'} ${totalOrders} PO(s) and ${totalItems} item(s); ${totalBlocked} PO(s) blocked by receipts, payments, or Xero links.`);
if (!APPLY) console.log(`To apply: node scripts/repair-cin7-foreign-purchase-orders.mjs --apply --confirm=${CONFIRM_TOKEN}`);