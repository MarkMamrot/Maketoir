/**
 * Replay the repaired Monsterthreads Shopify fulfillments that are currently
 * physically ready at Warehouse. Transfer-required #47724 and #47709 are
 * intentionally excluded.
 *
 * Dry run:
 *   node scripts/replay-monsterthreads-shopify-fulfilments-202608.mjs
 * Apply:
 *   node scripts/replay-monsterthreads-shopify-fulfilments-202608.mjs --apply
 */
import crypto from 'crypto';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import Shopify from 'shopify-api-node';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const ENDPOINT = process.argv.find(argument => argument.startsWith('--endpoint='))?.slice('--endpoint='.length)
  || 'https://solvantis.com.au';
const BUSINESS_NAME = 'Monsterthreads';
const EXPECTED_SCHEMA = 'readyedu_MonsterthreadsIMS';
const READY_ORDERS = ['#47706', '#47721', '#47725', '#47726', '#47732', '#47738', '#47746', '#47747', '#47748'];

function connectionConfig(database) {
  return {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database,
    connectTimeout: 20_000,
  };
}

function decrypt(value) {
  if (!value) return '';
  const parts = String(value).split(':');
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) return String(value);
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY is required.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], 'hex')), decipher.final()]).toString('utf8');
}

async function main() {
  const mainDb = await mysql.createConnection(connectionConfig(process.env.MYSQL_DATABASE));
  let imsDb;
  try {
    const [businessRows] = await mainDb.execute(
      `SELECT business_id, name, ims_db_name FROM businesses
        WHERE LOWER(name) = LOWER(?) AND COALESCE(is_sandbox, 0) = 0`,
      [BUSINESS_NAME],
    );
    if (businessRows.length !== 1 || businessRows[0].ims_db_name !== EXPECTED_SCHEMA) {
      throw new Error('Monsterthreads business/schema identity check failed.');
    }
    const business = businessRows[0];
    imsDb = await mysql.createConnection(connectionConfig(business.ims_db_name));

    const [settings] = await imsDb.execute(
      `SELECT value FROM ims_settings
        WHERE business_id = ? AND \`key\` = 'shopify_webhook_secret' LIMIT 1`,
      [business.business_id],
    );
    if (!settings[0]?.value) throw new Error('Shopify webhook secret is missing.');

    const [connections] = await mainDb.execute(
      'SELECT shopify_shop_id, shopify_access_token FROM connections WHERE business_id = ? LIMIT 1',
      [business.business_id],
    );
    if (!connections[0]?.shopify_shop_id || !connections[0]?.shopify_access_token) {
      throw new Error('Shopify credentials are missing.');
    }
    const shopify = new Shopify({
      shopName: String(connections[0].shopify_shop_id).replace(/\.myshopify\.com$/i, ''),
      accessToken: decrypt(connections[0].shopify_access_token),
      apiVersion: '2024-01',
      autoLimit: true,
    });

    const [orders] = await imsDb.execute(
      `SELECT id, shopify_order_id, shopify_order_name, status, location_id
         FROM ims_sales_orders
        WHERE business_id = ? AND shopify_order_name IN (${READY_ORDERS.map(() => '?').join(',')})`,
      [business.business_id, ...READY_ORDERS],
    );
    if (orders.length !== READY_ORDERS.length) {
      throw new Error(`Expected ${READY_ORDERS.length} ready orders, found ${orders.length}.`);
    }

    const plans = [];
    for (const orderName of READY_ORDERS) {
      const order = orders.find(row => row.shopify_order_name === orderName);
      if (!order || !['confirmed', 'partially_fulfilled', 'fulfilled'].includes(order.status)) {
        throw new Error(`${orderName} has unexpected IMS status ${order?.status}.`);
      }
      const [shortfalls] = await imsDb.execute(
        `SELECT soi.id, pv.sku, p.name, soi.qty_ordered - soi.qty_fulfilled AS required,
                COALESCE(s.qty_on_hand, 0) AS qty_on_hand
           FROM ims_sales_order_items soi
           JOIN ims_product_variants pv ON pv.variant_id = soi.variant_id
           JOIN ims_products p ON p.product_id = pv.product_id
           LEFT JOIN ims_stock s ON s.variant_id = soi.variant_id AND s.location_id = ?
          WHERE soi.so_id = ? AND COALESCE(p.is_stock_item, 1) = 1
            AND soi.qty_ordered > soi.qty_fulfilled
            AND COALESCE(s.qty_on_hand, 0) < soi.qty_ordered - soi.qty_fulfilled`,
        [order.location_id, order.id],
      );
      if (shortfalls.length > 0) {
        console.table(shortfalls);
        throw new Error(`${orderName} is no longer physically ready at Warehouse.`);
      }
      const shopifyOrder = await shopify.order.get(Number(order.shopify_order_id), {
        fields: 'id,name,fulfillment_status,fulfillments',
      });
      if (shopifyOrder.fulfillment_status !== 'fulfilled') {
        throw new Error(`${orderName} is not fulfilled in Shopify.`);
      }
      const fulfillments = (shopifyOrder.fulfillments || []).filter(fulfillment => fulfillment.status === 'success');
      if (fulfillments.length === 0) throw new Error(`${orderName} has no successful Shopify fulfillment.`);
      plans.push({ order, fulfillments });
    }

    console.table(plans.flatMap(plan => plan.fulfillments.map(fulfillment => ({
      order: plan.order.shopify_order_name,
      so_id: plan.order.id,
      ims_status: plan.order.status,
      fulfillment_id: String(fulfillment.id),
      line_count: fulfillment.line_items?.length ?? 0,
    }))));
    if (!APPLY) {
      console.log('DRY RUN: no webhooks posted. Re-run with --apply after reviewing this list.');
      return;
    }

    const url = `${ENDPOINT.replace(/\/$/, '')}/api/webhooks/shopify/orders/${business.business_id}`;
    for (const plan of plans) {
      if (plan.order.status === 'fulfilled') {
        console.log(`${plan.order.shopify_order_name}: already fulfilled in IMS, skipped.`);
        continue;
      }
      for (const fulfillment of plan.fulfillments) {
        const raw = JSON.stringify(fulfillment);
        const hmac = crypto.createHmac('sha256', settings[0].value).update(raw, 'utf8').digest('base64');
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-shopify-topic': 'fulfillments/create',
            'x-shopify-hmac-sha256': hmac,
          },
          body: raw,
        });
        const body = await response.text();
        if (!response.ok) throw new Error(`${plan.order.shopify_order_name} replay returned ${response.status}: ${body}`);
      }
      console.log(`${plan.order.shopify_order_name}: replay posted.`);
    }
  } finally {
    if (imsDb) await imsDb.end();
    await mainDb.end();
  }
}

main().catch(error => {
  console.error(`Replay aborted: ${error.message}`);
  process.exitCode = 1;
});