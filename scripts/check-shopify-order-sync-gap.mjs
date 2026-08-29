import 'dotenv/config';
import mysql from 'mysql2/promise';
import crypto from 'crypto';
import Shopify from 'shopify-api-node';

const argBusinessId = process.argv.find((a) => a.startsWith('--business-id='))?.split('=')[1] || '';
const argBusinessName = process.argv.find((a) => a.startsWith('--business-name='))?.split('=')[1] || 'Monsterthreads';
const argFrom = process.argv.find((a) => a.startsWith('--from='))?.split('=')[1] || '';

function decrypt(value) {
  if (!value) return '';
  const parts = String(value).split(':');
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) return String(value);
  const keyHex = process.env.ENCRYPTION_KEY || '';
  if (!keyHex) return String(value);
  const key = Buffer.from(keyHex, 'hex');
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

function encrypt(value) {
  const keyHex = process.env.ENCRYPTION_KEY || '';
  if (keyHex.length !== 64) throw new Error('ENCRYPTION_KEY must be configured to refresh Shopify credentials');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

async function resolveShopifyToken(mainDb, businessId, connection) {
  if (connection.shopify_auth_mode !== 'client_credentials') return decrypt(connection.shopify_access_token);
  const cachedToken = decrypt(connection.shopify_access_token).trim();
  const expiresAt = Number(connection.shopify_token_expires_at || 0);
  if (cachedToken && expiresAt > Date.now() + 5 * 60 * 1000) return cachedToken;

  const clientId = String(connection.shopify_client_id || '').trim();
  const clientSecret = decrypt(connection.shopify_client_secret).trim();
  if (!clientId || !clientSecret) throw new Error('Shopify client credentials are incomplete');
  const shopDomain = String(connection.shopify_shop_id).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token || !(Number(payload.expires_in) > 0)) {
    throw new Error(`Shopify token refresh failed with HTTP ${response.status}`);
  }
  const tokenExpiresAt = Date.now() + Number(payload.expires_in) * 1000;
  await mainDb.execute(
    'UPDATE connections SET shopify_access_token = ?, shopify_token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE business_id = ?',
    [encrypt(payload.access_token), tokenExpiresAt, businessId],
  );
  return payload.access_token;
}

function toAESTDateString(v) {
  const d = new Date(v);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(d);
}

async function openMainDb() {
  return mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
}

async function openImsDb(imsDbName) {
  return mysql.createConnection({
    host: process.env.IMS_MYSQL_HOST || process.env.MYSQL_HOST,
    port: Number(process.env.IMS_MYSQL_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.IMS_MYSQL_USER || process.env.MYSQL_USER,
    password: process.env.IMS_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD,
    database: imsDbName,
  });
}

async function resolveBusiness(mainDb) {
  if (argBusinessId) {
    const [rows] = await mainDb.execute(
      'SELECT business_id, name, ims_db_name FROM businesses WHERE business_id = ? LIMIT 1',
      [argBusinessId],
    );
    return rows[0] || null;
  }
  const [rows] = await mainDb.execute(
    'SELECT business_id, name, ims_db_name FROM businesses WHERE LOWER(name) = LOWER(?) LIMIT 1',
    [argBusinessName],
  );
  return rows[0] || null;
}

async function main() {
  const mainDb = await openMainDb();
  try {
    const business = await resolveBusiness(mainDb);
    if (!business) throw new Error('Business not found');

    const businessId = business.business_id;
    const imsDbName = business.ims_db_name || process.env.IMS_MYSQL_DATABASE;
    if (!imsDbName) throw new Error('No ims_db_name resolved');

    const imsDb = await openImsDb(imsDbName);
    try {
      const [cfgRows] = await imsDb.execute(
        `SELECT \`key\`, value FROM ims_settings
          WHERE business_id = ?
            AND \`key\` IN ('shopify_order_sync_from', 'shopify_order_sync_enabled')`,
        [businessId],
      );
      const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
      const fromDate = argFrom || cfg.shopify_order_sync_from || new Date().toISOString().slice(0, 10);

      const [connRows] = await mainDb.execute(
        `SELECT shopify_shop_id, shopify_auth_mode, shopify_access_token, shopify_client_id,
                shopify_client_secret, shopify_token_expires_at
           FROM connections WHERE business_id = ? LIMIT 1`,
        [businessId],
      );
      const conn = connRows[0];
      if (!conn?.shopify_shop_id || !conn?.shopify_access_token) {
        throw new Error('Shopify credentials are missing in connections');
      }

      const shopName = String(conn.shopify_shop_id).replace(/\.myshopify\.com$/i, '');
      const accessToken = await resolveShopifyToken(mainDb, businessId, conn);
      const shopify = new Shopify({
        shopName,
        accessToken,
        apiVersion: '2024-01',
        autoLimit: true,
      });

      const shopifyOrders = await shopify.order.list({
        status: 'any',
        limit: 250,
        created_at_min: `${fromDate}T00:00:00+10:00`,
        fields: 'id,name,created_at,financial_status,fulfillment_status,cancelled_at',
      });

      const [imsRows] = await imsDb.execute(
        `SELECT shopify_order_id
           FROM ims_sales_orders
          WHERE business_id = ?
            AND so_type = 'online'
            AND shopify_order_id IS NOT NULL
            AND shopify_order_id <> ''`,
        [businessId],
      );
      const imsIds = new Set(imsRows.map((r) => String(r.shopify_order_id)));

      const missing = [];
      for (const o of shopifyOrders) {
        const id = String(o.id);
        if (!imsIds.has(id)) {
          missing.push({
            id,
            name: o.name,
            created_at: o.created_at,
            created_aest: toAESTDateString(o.created_at),
            financial_status: o.financial_status || null,
            fulfillment_status: o.fulfillment_status || null,
            cancelled_at: o.cancelled_at || null,
          });
        }
      }

      console.table([
        {
          businessId,
          businessName: business.name,
          fromDate,
          syncEnabled: cfg.shopify_order_sync_enabled || '(unset)',
          shopifyOrders: shopifyOrders.length,
          imsOrdersWithShopifyId: imsRows.length,
          missingOrders: missing.length,
        },
      ]);

      if (missing.length) {
        console.log('Missing Shopify orders (first 50):');
        console.table(missing.slice(0, 50));
      }
    } finally {
      await imsDb.end();
    }
  } finally {
    await mainDb.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
