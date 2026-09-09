import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config({ path: '.env.local' });
dotenv.config();

const connectionOptions = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
};
const main = await mysql.createConnection({ ...connectionOptions, database: process.env.MYSQL_DATABASE });
const [businesses] = await main.execute(
  'SELECT business_id, ims_db_name FROM businesses WHERE deleted_at IS NULL AND ims_db_name IS NOT NULL',
);

for (const business of businesses) {
  if (!/^[A-Za-z0-9_]+$/.test(business.ims_db_name)) continue;
  const tenant = await mysql.createConnection({ ...connectionOptions, database: business.ims_db_name });
  const [rows] = await tenant.execute(
    `SELECT sales_order.id, sales_order.so_number, sales_order.status, sales_order.sales_channel,
            sales_order.so_type, SUM(item.qty_ordered) AS ordered, SUM(item.qty_fulfilled) AS fulfilled,
            shipment.id AS shipment_id, shipment.status AS shipment_status, shipment.ims_fulfilled_at
       FROM ims_sales_orders sales_order
       LEFT JOIN ims_sales_order_items item ON item.so_id = sales_order.id
       LEFT JOIN ims_shipping_shipments shipment
         ON shipment.so_id = sales_order.id
        AND shipment.business_id COLLATE utf8mb4_general_ci = sales_order.business_id COLLATE utf8mb4_general_ci
      WHERE sales_order.business_id COLLATE utf8mb4_general_ci = CONVERT(? USING utf8mb4) COLLATE utf8mb4_general_ci
        AND sales_order.so_number IN (?, ?)
      GROUP BY sales_order.id, sales_order.so_number, sales_order.status, sales_order.sales_channel,
               sales_order.so_type, shipment.id, shipment.status, shipment.ims_fulfilled_at`,
    [business.business_id, 'ONL-20260908-349720', 'ONL-20260908-528728'],
  );
  if (rows.length) {
    const orderIds = rows.map(row => Number(row.id));
    const [operations] = await tenant.query(
      `SELECT so_id, operation_key, status, created_at, completed_at
         FROM ims_so_fulfilment_operations
        WHERE business_id COLLATE utf8mb4_general_ci = CONVERT(? USING utf8mb4) COLLATE utf8mb4_general_ci
          AND so_id IN (?)
        ORDER BY id`,
      [business.business_id, orderIds],
    );
    const [shopifyShipments] = await tenant.query(
      `SELECT so_id, shopify_fulfilment_id, status, fulfilled_at
         FROM ims_so_shipments
        WHERE business_id COLLATE utf8mb4_general_ci = CONVERT(? USING utf8mb4) COLLATE utf8mb4_general_ci
          AND so_id IN (?)
        ORDER BY id`,
      [business.business_id, orderIds],
    );
    console.log(JSON.stringify({ businessId: business.business_id, rows, operations, shopifyShipments }));
  }
  await tenant.end();
}

await main.end();