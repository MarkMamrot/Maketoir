import 'dotenv/config';
import mysql from 'mysql2/promise';

const requestedBusiness = process.argv.find(argument => argument.startsWith('--business='))?.slice('--business='.length).trim();
if (!requestedBusiness) throw new Error('Usage: node scripts/audit-shopify-exact-cutover.mjs --business=<business-id-or-name>');

const mainSchema = process.env.MYSQL_DATABASE;
if (!mainSchema || !/^[A-Za-z0-9_]+$/.test(mainSchema)) throw new Error('MYSQL_DATABASE is required.');

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: mainSchema,
});

function object(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return object(JSON.parse(value)); } catch { return {}; }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function tableExists(schema, table) {
  const [rows] = await connection.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1',
    [schema, table],
  );
  return rows.length === 1;
}

async function columnExists(schema, table, column) {
  const [rows] = await connection.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [schema, table, column],
  );
  return rows.length === 1;
}

try {
  const [businesses] = await connection.query(
    `SELECT business.business_id, business.name, business.ims_db_name,
            capability.shopify_enabled, legacy.shopify_shop_id, legacy.shopify_auth_mode
       FROM businesses business
       LEFT JOIN business_online_channels capability ON BINARY capability.business_id = BINARY business.business_id
       LEFT JOIN connections legacy ON BINARY legacy.business_id = BINARY business.business_id
      WHERE (BINARY business.business_id = BINARY ? OR LOWER(business.name) = LOWER(?))
        AND business.deleted_at IS NULL`,
    [requestedBusiness, requestedBusiness],
  );
  if (businesses.length !== 1) throw new Error('Business not found.');
  const business = businesses[0];
  const schema = String(business.ims_db_name ?? '');
  if (!/^[A-Za-z0-9_]+$/.test(schema)) throw new Error('Business IMS schema is invalid.');

  const [instances] = await connection.query(
    `SELECT instance.channel_instance_id, instance.display_name, instance.external_account_key,
            instance.is_enabled, instance.runtime_status, instance.readiness_status, instance.settings_json,
            COUNT(DISTINCT credential.channel_instance_id) AS credential_count,
            COUNT(DISTINCT webhook.id) AS webhook_count,
            SUM(webhook.registration_status = 'registered' AND webhook.provider_registration_id IS NOT NULL) AS registered_webhook_count
       FROM sales_channel_instances instance
       LEFT JOIN sales_channel_credentials credential
         ON credential.channel_instance_id = instance.channel_instance_id
        AND credential.credential_type = 'shopify_admin_api'
       LEFT JOIN sales_channel_webhooks webhook ON webhook.channel_instance_id = instance.channel_instance_id
      WHERE BINARY instance.business_id = BINARY ? AND instance.provider = 'shopify'
      GROUP BY instance.channel_instance_id, instance.display_name, instance.external_account_key,
               instance.is_enabled, instance.runtime_status, instance.readiness_status, instance.settings_json`,
    [business.business_id],
  );
  const [domainInstances] = await connection.query(
    `SELECT channel_instance_id, business_id, display_name, external_account_key,
            is_enabled, runtime_status, readiness_status
       FROM sales_channel_instances
      WHERE provider = 'shopify' AND LOWER(external_account_key) = LOWER(?)`,
    [business.shopify_shop_id],
  );

  const [legacyRows] = await connection.query(
    `SELECT \`key\`, value FROM \`${schema}\`.ims_settings
      WHERE business_id = ? AND \`key\` IN (
        'shopify_order_sync_enabled','shopify_order_sync_from','online_sales_location_id',
        'shopify_inventory_sync_enabled','shopify_inventory_sync_interval_minutes',
        'shopify_inventory_sync_last_run_at','shopify_inventory_location_id',
        'shopify_inventory_buffer','online_pick_priority','shopify_gc_mode',
        'shopify_xero_auto_sync_enabled','shopify_webhook_secret'
      )`,
    [business.business_id],
  );
  const legacy = new Map(legacyRows.map(row => [String(row.key), row.value]));
  const exact = object(object(instances[0]?.settings_json).shopify);
  const exactOrders = object(exact.orders);
  const exactInventory = object(exact.inventory);
  const exactGiftCards = object(exact.giftCards);
  const exactXero = object(exact.xero);

  const parity = {
    orderSyncEnabled: exactOrders.enabled === (legacy.get('shopify_order_sync_enabled') === '1'),
    orderSyncFrom: String(exactOrders.syncFrom ?? '') === String(legacy.get('shopify_order_sync_from') ?? ''),
    orderLocationId: Number(exactOrders.locationId ?? 0) === Number(legacy.get('online_sales_location_id') ?? 0),
    inventoryEnabled: exactInventory.enabled === (legacy.get('shopify_inventory_sync_enabled') === '1'),
    inventoryInterval: Number(exactInventory.intervalMinutes ?? 15) === Number(legacy.get('shopify_inventory_sync_interval_minutes') ?? 15),
    inventoryLocationId: Number(exactInventory.locationId ?? 0) === Number(legacy.get('shopify_inventory_location_id') ?? 0),
    inventoryBuffer: Number(exactInventory.buffer ?? 0) === Number(legacy.get('shopify_inventory_buffer') ?? 0),
    giftCardMode: String(exactGiftCards.mode ?? 'off') === String(legacy.get('shopify_gc_mode') ?? 'off'),
    dailyXeroAutoSync: exactXero.dailyAutoSyncEnabled === (legacy.get('shopify_xero_auto_sync_enabled') !== '0'),
  };

  const ownershipChecks = [];
  for (const check of [
    ['orders', 'ims_sales_orders', 'channel_instance_id', "shopify_order_id IS NOT NULL AND shopify_order_id <> ''"],
    ['creditNotes', 'ims_credit_notes', 'channel_instance_id', "source = 'shopify'"],
    ['giftCards', 'gift_cards', 'channel_instance_id', 'shopify_gc_id IS NOT NULL'],
    ['shipments', 'ims_so_shipments', 'channel_instance_id', 'shopify_fulfilment_id IS NOT NULL'],
  ]) {
    const [label, table, column, predicate] = check;
    if (!await tableExists(schema, table) || !await columnExists(schema, table, column)) {
      ownershipChecks.push({ label, schemaReady: false, unresolved: null });
      continue;
    }
    const [[row]] = await connection.query(
      `SELECT COUNT(*) AS unresolved FROM \`${schema}\`.\`${table}\` WHERE ${predicate} AND \`${column}\` IS NULL`,
    );
    ownershipChecks.push({ label, schemaReady: true, unresolved: Number(row.unresolved) });
  }

  const requiredTables = ['ims_contact_channel_mappings', 'ims_sales_channel_events', 'ims_sales_channel_product_mappings'];
  const tenantTables = Object.fromEntries(await Promise.all(requiredTables.map(async table => [table, await tableExists(schema, table)])));
  const settingsParity = Object.values(parity).every(Boolean);
  const ownershipReady = ownershipChecks.every(check => check.schemaReady && check.unresolved === 0);
  const soleInstanceReady = instances.length === 1
    && Number(instances[0].is_enabled) === 1
    && instances[0].runtime_status === 'active'
    && instances[0].readiness_status === 'ready'
    && Number(instances[0].credential_count) === 1;
  const publicationEnabled = object(instances[0]?.settings_json).productPublicationEnabled === true;

  console.log(JSON.stringify({
    business: { id: business.business_id, name: business.name, schema, shopifyCapabilityEnabled: Number(business.shopify_enabled) === 1 },
    legacy: {
      shopDomain: business.shopify_shop_id,
      authMode: business.shopify_auth_mode,
      webhookSecretConfigured: Boolean(String(legacy.get('shopify_webhook_secret') ?? '').trim()),
    },
    instances: instances.map(instance => ({
      channelInstanceId: instance.channel_instance_id,
      displayName: instance.display_name,
      shopDomain: instance.external_account_key,
      enabled: Boolean(instance.is_enabled),
      runtimeStatus: instance.runtime_status,
      readinessStatus: instance.readiness_status,
      credentials: Number(instance.credential_count),
      webhooks: Number(instance.webhook_count),
      registeredWebhooks: Number(instance.registered_webhook_count ?? 0),
    })),
    domainInstances,
    parity,
    ownershipChecks,
    tenantTables,
    publicationEnabled,
    readyForExactCutover: soleInstanceReady && settingsParity && ownershipReady
      && Object.values(tenantTables).every(Boolean) && !publicationEnabled,
  }, null, 2));
} finally {
  await connection.end();
}
