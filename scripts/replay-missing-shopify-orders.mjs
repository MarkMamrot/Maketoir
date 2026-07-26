import 'dotenv/config';
import mysql from 'mysql2/promise';
import crypto from 'crypto';
import Shopify from 'shopify-api-node';

const argBusinessId = process.argv.find((a) => a.startsWith('--business-id='))?.split('=')[1] || '';
const argBusinessName = process.argv.find((a) => a.startsWith('--business-name='))?.split('=')[1] || 'Monsterthreads';
const argFrom = process.argv.find((a) => a.startsWith('--from='))?.split('=')[1] || new Date().toISOString().slice(0, 10);
const argEndpoint = process.argv.find((a) => a.startsWith('--endpoint='))?.split('=')[1] || 'http://127.0.0.1:3000';
const APPLY = process.argv.includes('--apply');

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
      const [settingsRows] = await imsDb.execute(
        `SELECT \`key\`, value
           FROM ims_settings
          WHERE business_id = ?
            AND \`key\` IN ('shopify_webhook_secret', 'shopify_order_sync_enabled')`,
        [businessId],
      );
      const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
      const webhookSecret = settings.shopify_webhook_secret || '';
      if (!webhookSecret) throw new Error('Missing shopify_webhook_secret setting');
      if (settings.shopify_order_sync_enabled !== '1') {
        throw new Error('shopify_order_sync_enabled is not 1 for this business');
      }

      const [connRows] = await mainDb.execute(
        'SELECT shopify_shop_id, shopify_access_token FROM connections WHERE business_id = ? LIMIT 1',
        [businessId],
      );
      const conn = connRows[0];
      if (!conn?.shopify_shop_id || !conn?.shopify_access_token) {
        throw new Error('Shopify credentials are missing in connections');
      }

      const shopName = String(conn.shopify_shop_id).replace(/\.myshopify\.com$/i, '');
      const accessToken = decrypt(conn.shopify_access_token);
      const shopify = new Shopify({
        shopName,
        accessToken,
        apiVersion: '2024-01',
        autoLimit: true,
      });

      const orders = await shopify.order.list({
        status: 'any',
        limit: 250,
        created_at_min: `${argFrom}T00:00:00+10:00`,
        fields: 'id,name',
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

      const missing = orders.filter((o) => !imsIds.has(String(o.id)));
      console.table([
        {
          businessId,
          businessName: business.name,
          fromDate: argFrom,
          endpoint: argEndpoint,
          shopifyOrders: orders.length,
          missingOrders: missing.length,
          apply: APPLY,
        },
      ]);

      if (!missing.length) {
        console.log('No missing orders to replay.');
        return;
      }

      console.log('Missing order IDs:');
      console.table(missing.map((o) => ({ id: String(o.id), name: o.name || null })));
      if (!APPLY) {
        console.log('Dry-run only. Re-run with --apply to POST signed webhook replays.');
        return;
      }

      const url = `${argEndpoint}/api/webhooks/shopify/orders/${businessId}`;
      let okCount = 0;
      for (const m of missing) {
        const fullOrder = await shopify.order.get(m.id);
        const raw = JSON.stringify(fullOrder);
        const hmac = crypto.createHmac('sha256', webhookSecret).update(raw, 'utf8').digest('base64');
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-shopify-topic': 'orders/paid',
            'x-shopify-hmac-sha256': hmac,
          },
          body: raw,
        });
        const text = await res.text();
        if (!res.ok) {
          console.error(`Replay failed for ${m.id} (${m.name}): ${res.status} ${text}`);
        } else {
          okCount++;
          console.log(`Replayed ${m.id} (${m.name}) -> ${res.status}`);
        }
      }
      console.log(`Replay complete: ${okCount}/${missing.length} succeeded`);
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
