/**
 * Restore Shopify shipping addresses on currently confirmed Monsterthreads
 * Sales Orders. Dry run is the default; pass --apply to update IMS.
 *
 * Dry run: node scripts/backfill-monsterthreads-shopify-delivery-addresses.mjs
 * Apply:   node scripts/backfill-monsterthreads-shopify-delivery-addresses.mjs --apply
 */
import 'dotenv/config';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import Shopify from 'shopify-api-node';

const APPLY = process.argv.includes('--apply');
const BUSINESS_NAME = 'Monsterthreads';
const EXPECTED_SCHEMA = 'readyedu_MonsterthreadsIMS';
const DELIVERY_COLUMNS = [
  'delivery_address',
  'delivery_address2',
  'delivery_suburb',
  'delivery_city',
  'delivery_state',
  'delivery_postcode',
  'delivery_country',
];

function connectionConfig(database, ims = false) {
  return {
    host: ims ? process.env.IMS_MYSQL_HOST || process.env.MYSQL_HOST : process.env.MYSQL_HOST,
    port: Number(ims ? process.env.IMS_MYSQL_PORT || process.env.MYSQL_PORT || 3306 : process.env.MYSQL_PORT || 3306),
    user: ims ? process.env.IMS_MYSQL_USER || process.env.MYSQL_USER : process.env.MYSQL_USER,
    password: ims ? process.env.IMS_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD : process.env.MYSQL_PASSWORD,
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

function encrypt(value) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY is required.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

async function resolveShopifyToken(mainDb, businessId, connection) {
  if (connection.shopify_auth_mode !== 'client_credentials') {
    return decrypt(connection.shopify_access_token).trim();
  }
  const cachedToken = decrypt(connection.shopify_access_token).trim();
  if (cachedToken && Number(connection.shopify_token_expires_at || 0) > Date.now() + 5 * 60 * 1000) {
    return cachedToken;
  }

  const clientId = String(connection.shopify_client_id || '').trim();
  const clientSecret = decrypt(connection.shopify_client_secret).trim();
  if (!clientId || !clientSecret) throw new Error('Shopify client credentials are incomplete.');
  const shopDomain = String(connection.shopify_shop_id).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token || !(Number(payload.expires_in) > 0)) {
    throw new Error(`Shopify token refresh failed with HTTP ${response.status}.`);
  }
  const expiresAt = Date.now() + Number(payload.expires_in) * 1000;
  await mainDb.execute(
    'UPDATE connections SET shopify_access_token = ?, shopify_token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE business_id = ?',
    [encrypt(payload.access_token), expiresAt, businessId],
  );
  return payload.access_token;
}

function text(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function deliveryAddress(order) {
  const address = order?.shipping_address && typeof order.shipping_address === 'object'
    ? order.shipping_address
    : {};
  const city = text(address.city);
  return {
    delivery_address: text(address.address1),
    delivery_address2: text(address.address2),
    delivery_suburb: city,
    delivery_city: city,
    delivery_state: text(address.province_code) || text(address.province),
    delivery_postcode: text(address.zip),
    delivery_country: text(address.country_code) || text(address.country),
  };
}

function changedColumns(row, address) {
  return DELIVERY_COLUMNS.filter(column => text(row[column]) !== address[column]);
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
      throw new Error('Live Monsterthreads business/schema identity check failed.');
    }
    const business = businessRows[0];
    imsDb = await mysql.createConnection(connectionConfig(business.ims_db_name, true));

    const [connectionRows] = await mainDb.execute(
      `SELECT shopify_shop_id, shopify_auth_mode, shopify_access_token, shopify_client_id,
              shopify_client_secret, shopify_token_expires_at
         FROM connections WHERE business_id = ? LIMIT 1`,
      [business.business_id],
    );
    const connection = connectionRows[0];
    if (!connection?.shopify_shop_id) throw new Error('Monsterthreads Shopify connection is missing.');
    const accessToken = await resolveShopifyToken(mainDb, business.business_id, connection);
    if (!accessToken) throw new Error('Monsterthreads Shopify access token is missing.');
    const shopName = String(connection.shopify_shop_id)
      .replace(/^https?:\/\//i, '')
      .replace(/\.myshopify\.com\/?$/i, '');
    const shopify = new Shopify({ shopName, accessToken, apiVersion: '2024-01', autoLimit: true });

    const [orders] = await imsDb.execute(
      `SELECT id, so_number, shopify_order_id, shopify_order_name,
              delivery_address, delivery_address2, delivery_suburb, delivery_city,
              delivery_state, delivery_postcode, delivery_country
         FROM ims_sales_orders
        WHERE business_id = ?
          AND status = 'confirmed'
          AND shopify_order_id IS NOT NULL
          AND shopify_order_id <> ''
        ORDER BY id`,
      [business.business_id],
    );

    const plans = [];
    let missingShippingAddress = 0;
    for (const order of orders) {
      const shopifyOrder = await shopify.order.get(Number(order.shopify_order_id), {
        fields: 'id,name,fulfillment_status,shipping_address',
      });
      if (shopifyOrder.fulfillment_status === 'fulfilled') continue;
      const address = deliveryAddress(shopifyOrder);
      if (!address.delivery_address) {
        missingShippingAddress += 1;
        plans.push({ order, action: 'no_shipping_address', address, changed: [] });
        continue;
      }
      const changed = changedColumns(order, address);
      plans.push({ order, action: changed.length ? 'update' : 'unchanged', address, changed });
    }

    const updates = plans.filter(plan => plan.action === 'update');
    console.table(plans.map(plan => ({
      so_number: plan.order.so_number,
      channel_order: plan.order.shopify_order_name || String(plan.order.shopify_order_id),
      action: plan.action,
      fields_changed: plan.changed.length,
    })));
    console.table([{
      confirmed_shopify_orders: orders.length,
      unfulfilled_in_shopify: plans.length,
      updates: updates.length,
      unchanged: plans.filter(plan => plan.action === 'unchanged').length,
      no_shipping_address: missingShippingAddress,
      apply: APPLY,
    }]);

    if (!APPLY) {
      console.log('DRY RUN: no IMS rows updated. Re-run with --apply after reviewing this summary.');
      return;
    }

    await imsDb.beginTransaction();
    try {
      for (const plan of updates) {
        const address = plan.address;
        const [result] = await imsDb.execute(
          `UPDATE ims_sales_orders
              SET delivery_address = ?, delivery_address2 = ?, delivery_suburb = ?, delivery_city = ?,
                  delivery_state = ?, delivery_postcode = ?, delivery_country = ?
            WHERE business_id = ? AND id = ? AND status = 'confirmed'`,
          [...DELIVERY_COLUMNS.map(column => address[column]), business.business_id, plan.order.id],
        );
        if (result.affectedRows !== 1) {
          throw new Error(`Sales Order ${plan.order.so_number} changed during recovery; transaction aborted.`);
        }
      }
      await imsDb.commit();
    } catch (error) {
      await imsDb.rollback();
      throw error;
    }

    let verified = 0;
    for (const plan of updates) {
      const [rows] = await imsDb.execute(
        `SELECT delivery_address, delivery_address2, delivery_suburb, delivery_city,
                delivery_state, delivery_postcode, delivery_country
           FROM ims_sales_orders WHERE business_id = ? AND id = ? LIMIT 1`,
        [business.business_id, plan.order.id],
      );
      if (rows[0] && changedColumns(rows[0], plan.address).length === 0) verified += 1;
    }
    if (verified !== updates.length) throw new Error(`Verification failed: ${verified}/${updates.length} rows match Shopify.`);
    console.log(`Applied and verified ${verified} delivery-address updates.`);
  } finally {
    if (imsDb) await imsDb.end();
    await mainDb.end();
  }
}

main().catch(error => {
  console.error(`Delivery-address recovery aborted: ${error.message}`);
  process.exitCode = 1;
});