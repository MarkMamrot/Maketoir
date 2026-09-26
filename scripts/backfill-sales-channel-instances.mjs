/**
 * Backfills the channel-instance foundation from legacy Shopify and Native Shop state.
 * Dry-run: node scripts/backfill-sales-channel-instances.mjs
 * Apply:   node scripts/backfill-sales-channel-instances.mjs --apply
 */
import 'dotenv/config';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const settingsOnly = process.argv.includes('--settings-only');
const requestedBusinessId = process.argv.find(argument => argument.startsWith('--business='))?.slice('--business='.length).trim() || null;
const database = process.env.MYSQL_DATABASE;
if (!database) throw new Error('MYSQL_DATABASE is required.');

function assertSchemaName(value) {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error(`Unsafe IMS schema name: ${value}`);
  return value;
}

function normalizeShopifyDomain(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  return normalized && !normalized.includes('.') ? `${normalized}.myshopify.com` : normalized;
}

function encryptionKey() {
  const keyHex = process.env.ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('ENCRYPTION_KEY must be a 64-character hex string.');
  return Buffer.from(keyHex, 'hex');
}

function decryptStoredValue(value) {
  const stored = String(value ?? '');
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32
    || !parts.every(part => /^[0-9a-f]*$/i.test(part))) return stored;
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(parts[0], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], 'hex')), decipher.final()]).toString('utf8');
}

function encryptEnvelope(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`;
}

function encryptText(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`;
}

const SHOPIFY_EXACT_WEBHOOK_TOPICS = [
  'orders/create', 'orders/paid', 'orders/updated', 'orders/cancelled',
  'fulfillments/create', 'fulfillments/update', 'orders/fulfilled',
  'refunds/create', 'returns/update',
  'shopify_payments/payouts/create', 'shopify_payments/payouts/update',
];

function hasShopifyCredentials(row) {
  if (row.shopify_auth_mode === 'client_credentials') {
    return Boolean(String(row.shopify_client_id ?? '').trim() && String(row.shopify_client_secret ?? '').trim());
  }
  return Boolean(String(row.shopify_access_token ?? '').trim());
}

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database,
});

async function findInstance(businessId, provider, externalAccountKey) {
  const [rows] = await connection.query(
    `SELECT channel_instance_id
       FROM sales_channel_instances
      WHERE BINARY business_id = BINARY ? AND provider = ?
        AND (external_account_key = ? OR (? IS NULL AND external_account_key IS NULL))
      LIMIT 1`,
    [businessId, provider, externalAccountKey, externalAccountKey],
  );
  return rows[0]?.channel_instance_id ?? null;
}

async function ensureInstance(input) {
  const existingId = await findInstance(input.businessId, input.provider, input.externalAccountKey);
  if (existingId) return { channelInstanceId: existingId, created: false };
  const channelInstanceId = randomUUID();
  if (apply) {
    await connection.query(
      `INSERT INTO sales_channel_instances
         (channel_instance_id, business_id, provider, display_name, external_account_key, singleton_key,
          is_enabled, runtime_status, readiness_status, settings_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [channelInstanceId, input.businessId, input.provider, input.displayName, input.externalAccountKey,
        input.provider === 'native_shop' ? 'native_shop' : null, input.enabled ? 1 : 0,
        input.enabled ? 'active' : 'paused', input.ready ? 'ready' : 'not_tested',
        JSON.stringify({ migrationSource: 'legacy_channels' })],
    );
  }
  return { channelInstanceId, created: true };
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
}

function changedJsonPaths(current, next, prefix = '') {
  const currentObject = objectValue(current);
  const nextObject = objectValue(next);
  const keys = [...new Set([...Object.keys(currentObject), ...Object.keys(nextObject)])].sort();
  return keys.flatMap(key => {
    const path = prefix ? `${prefix}.${key}` : key;
    const before = currentObject[key];
    const after = nextObject[key];
    if (before && after && typeof before === 'object' && typeof after === 'object'
      && !Array.isArray(before) && !Array.isArray(after)) {
      return changedJsonPaths(before, after, path);
    }
    return JSON.stringify(canonicalJson(before)) === JSON.stringify(canonicalJson(after)) ? [] : [path];
  });
}

async function migrateShopifySettings(business, channelInstanceId) {
  const [[instanceRows], [legacyRows]] = await Promise.all([
    connection.query('SELECT settings_json FROM sales_channel_instances WHERE channel_instance_id = ? LIMIT 1', [channelInstanceId]),
    connection.query(
      `SELECT \`key\`, value FROM \`${business.ims_db_name}\`.ims_settings
        WHERE business_id = ? AND \`key\` IN (
          'shopify_order_sync_enabled','shopify_order_sync_from','online_sales_location_id',
          'shopify_inventory_sync_enabled','shopify_inventory_sync_interval_minutes',
          'shopify_inventory_sync_last_run_at','shopify_inventory_location_id',
          'shopify_inventory_buffer','online_pick_priority','shopify_gc_mode','shopify_xero_auto_sync_enabled'
        )`,
      [business.business_id],
    ).catch(() => [[]]),
  ]);
  const instance = instanceRows[0];
  const current = objectValue(typeof instance?.settings_json === 'string'
    ? JSON.parse(instance.settings_json || '{}')
    : instance?.settings_json);
  const shopify = objectValue(current.shopify);
  const orders = { ...objectValue(shopify.orders) };
  const inventory = { ...objectValue(shopify.inventory) };
  const giftCards = { ...objectValue(shopify.giftCards) };
  const xero = { ...objectValue(shopify.xero) };
  const legacy = new Map(legacyRows.map(row => [String(row.key), row.value]));

  if (orders.enabled === undefined && legacy.has('shopify_order_sync_enabled')) orders.enabled = legacy.get('shopify_order_sync_enabled') === '1';
  if (orders.syncFrom === undefined && legacy.get('shopify_order_sync_from')) orders.syncFrom = legacy.get('shopify_order_sync_from');
  if (orders.locationId === undefined && Number(legacy.get('online_sales_location_id')) > 0) orders.locationId = Number(legacy.get('online_sales_location_id'));
  if (inventory.enabled === undefined && legacy.has('shopify_inventory_sync_enabled')) inventory.enabled = legacy.get('shopify_inventory_sync_enabled') === '1';
  if (inventory.intervalMinutes === undefined && Number(legacy.get('shopify_inventory_sync_interval_minutes')) > 0) inventory.intervalMinutes = Number(legacy.get('shopify_inventory_sync_interval_minutes'));
  if (inventory.lastRunAt === undefined && legacy.get('shopify_inventory_sync_last_run_at')) inventory.lastRunAt = legacy.get('shopify_inventory_sync_last_run_at');
  if (inventory.locationId === undefined && Number(legacy.get('shopify_inventory_location_id')) > 0) inventory.locationId = Number(legacy.get('shopify_inventory_location_id'));
  if (inventory.buffer === undefined && Number.isFinite(Number(legacy.get('shopify_inventory_buffer')))) inventory.buffer = Math.max(0, Number(legacy.get('shopify_inventory_buffer')));
  if (inventory.pickLocationIds === undefined && legacy.get('online_pick_priority')) {
    try {
      const locations = JSON.parse(String(legacy.get('online_pick_priority')));
      if (Array.isArray(locations)) inventory.pickLocationIds = locations.map(Number).filter(Number.isInteger);
    } catch {}
  }
  if (giftCards.mode === undefined && legacy.has('shopify_gc_mode')) giftCards.mode = legacy.get('shopify_gc_mode') === 'combined' ? 'combined' : 'off';
  if (xero.dailyAutoSyncEnabled === undefined) xero.dailyAutoSyncEnabled = legacy.get('shopify_xero_auto_sync_enabled') !== '0';

  const next = { ...current, shopify: { ...shopify, orders, inventory, giftCards, xero } };
  const changed = JSON.stringify(canonicalJson(next)) !== JSON.stringify(canonicalJson(current));
  if (apply && changed) {
    await connection.query(
      'UPDATE sales_channel_instances SET settings_json = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE channel_instance_id = ?',
      [JSON.stringify(next), channelInstanceId],
    );
  }
  return { changed, changedPaths: changedJsonPaths(current, next) };
}

async function prepareShopifyWebhookCutover(business, channelInstanceId) {
  const [rows] = await connection.query(
    `SELECT value FROM \`${business.ims_db_name}\`.ims_settings
      WHERE business_id = ? AND \`key\` = 'shopify_webhook_secret' LIMIT 1`,
    [business.business_id],
  );
  const secret = String(rows[0]?.value ?? '').trim();
  if (!secret) return 0;
  const encryptedSecret = encryptText(secret);
  let prepared = 0;
  for (const topic of SHOPIFY_EXACT_WEBHOOK_TOPICS) {
    if (apply) {
      const [result] = await connection.query(
        `INSERT INTO sales_channel_webhooks
           (channel_instance_id, topic, provider_registration_id, encrypted_secret,
            registration_status, safe_error)
         VALUES (?, ?, NULL, ?, 'registered', 'Exact provider URL registration pending')
         ON DUPLICATE KEY UPDATE
           encrypted_secret = COALESCE(encrypted_secret, VALUES(encrypted_secret)),
           registration_status = IF(provider_registration_id IS NULL, 'registered', registration_status),
           safe_error = IF(provider_registration_id IS NULL, VALUES(safe_error), safe_error)`,
        [channelInstanceId, topic, encryptedSecret],
      );
      prepared += Number(result.affectedRows ?? 0) > 0 ? 1 : 0;
    } else {
      prepared += 1;
    }
  }
  return prepared;
}

async function migrateShopify(business) {
  const domain = normalizeShopifyDomain(business.shopify_shop_id);
  if (!domain) return null;
  if (settingsOnly) {
    const channelInstanceId = await findInstance(business.business_id, 'shopify', domain);
    if (!channelInstanceId) {
      return { created: false, domain, counts: { settings: 0, settingsReviewRequired: 1 } };
    }
    const [shopifyInstanceRows] = await connection.query(
      `SELECT COUNT(*) AS count FROM sales_channel_instances WHERE business_id = ? AND provider = 'shopify'`,
      [business.business_id],
    );
    const legacyOwnershipIsUnambiguous = Number(shopifyInstanceRows[0]?.count ?? 0) === 1;
    const settingsMigration = legacyOwnershipIsUnambiguous
      ? await migrateShopifySettings(business, channelInstanceId)
      : { changed: false, changedPaths: [] };
    return {
      created: false,
      domain,
      counts: {
        settings: settingsMigration.changed ? 1 : 0,
        settingsChangedPaths: settingsMigration.changedPaths,
        settingsReviewRequired: legacyOwnershipIsUnambiguous ? 0 : 1,
      },
    };
  }
  const ready = hasShopifyCredentials(business);
  const instance = await ensureInstance({
    businessId: business.business_id,
    provider: 'shopify',
    displayName: `${business.name} Shopify`,
    externalAccountKey: domain,
    enabled: business.shopify_enabled === 1,
    ready,
  });
  const [shopifyInstanceRows] = await connection.query(
    `SELECT COUNT(*) AS count FROM sales_channel_instances WHERE business_id = ? AND provider = 'shopify'`,
    [business.business_id],
  );
  const shopifyInstanceCount = Number(shopifyInstanceRows[0]?.count ?? 0) + (!apply && instance.created ? 1 : 0);
  const legacyOwnershipIsUnambiguous = shopifyInstanceCount === 1;
  const settingsMigration = legacyOwnershipIsUnambiguous
    ? await migrateShopifySettings(business, instance.channelInstanceId)
    : { changed: false, changedPaths: [] };
  const webhooksPrepared = legacyOwnershipIsUnambiguous
    ? await prepareShopifyWebhookCutover(business, instance.channelInstanceId)
    : 0;
  const counts = { products: 0, variants: 0, selections: 0, canonicalMappings: 0, assignments: 0,
    credentials: 0, settings: settingsMigration.changed ? 1 : 0,
    settingsChangedPaths: settingsMigration.changedPaths, webhooksPrepared,
    settingsReviewRequired: legacyOwnershipIsUnambiguous ? 0 : 1,
    productConflictOwners: 0, variantConflictOwners: 0 };
  const [[productConflictRows], [variantConflictRows]] = await Promise.all([
    connection.query(
      `SELECT COALESCE(SUM(owner_count), 0) AS owner_count
         FROM (
           SELECT COUNT(*) AS owner_count
             FROM \`${business.ims_db_name}\`.ims_products
            WHERE business_id = ? AND shopify_product_id IS NOT NULL AND shopify_product_id <> ''
            GROUP BY shopify_product_id HAVING COUNT(*) > 1
         ) conflicts`,
      [business.business_id],
    ),
    connection.query(
      `SELECT COALESCE(SUM(owner_count), 0) AS owner_count
         FROM (
           SELECT COUNT(*) AS owner_count
             FROM \`${business.ims_db_name}\`.ims_product_variants
            WHERE business_id = ? AND shopify_variant_id IS NOT NULL AND shopify_variant_id <> ''
            GROUP BY shopify_variant_id HAVING COUNT(*) > 1
         ) conflicts`,
      [business.business_id],
    ),
  ]);
  counts.productConflictOwners = Number(productConflictRows[0]?.owner_count ?? 0);
  counts.variantConflictOwners = Number(variantConflictRows[0]?.owner_count ?? 0);
  const [[productCountRows], [variantCountRows], [canonicalMappingCountRows]] = await Promise.all([
    connection.query(`SELECT COUNT(*) AS count FROM \`${business.ims_db_name}\`.ims_products
      WHERE business_id = ? AND shopify_product_id IS NOT NULL AND shopify_product_id <> ''`, [business.business_id]),
    connection.query(`SELECT COUNT(*) AS count FROM \`${business.ims_db_name}\`.ims_product_variants
      WHERE business_id = ? AND shopify_variant_id IS NOT NULL AND shopify_variant_id <> ''`, [business.business_id]),
    connection.query(
      `SELECT COUNT(*) AS count
         FROM \`${business.ims_db_name}\`.ims_product_variants variant
         JOIN \`${business.ims_db_name}\`.ims_products product
           ON BINARY product.business_id = BINARY variant.business_id AND product.product_id = variant.product_id
        WHERE variant.business_id = ?
          AND product.shopify_product_id IS NOT NULL AND product.shopify_product_id <> ''
          AND variant.shopify_variant_id IS NOT NULL AND variant.shopify_variant_id <> ''
          AND NOT EXISTS (
            SELECT 1 FROM \`${business.ims_db_name}\`.ims_products duplicate
             WHERE BINARY duplicate.business_id = BINARY product.business_id
               AND duplicate.shopify_product_id = product.shopify_product_id
               AND duplicate.product_id <> product.product_id)
          AND NOT EXISTS (
            SELECT 1 FROM \`${business.ims_db_name}\`.ims_product_variants duplicate
             WHERE BINARY duplicate.business_id = BINARY variant.business_id
               AND duplicate.shopify_variant_id = variant.shopify_variant_id
               AND duplicate.variant_id <> variant.variant_id)`,
      [business.business_id],
    ),
  ]);
  const sourceProducts = Number(productCountRows[0]?.count ?? 0);
  const sourceVariants = Number(variantCountRows[0]?.count ?? 0);
  const expectedCanonicalMappings = Number(canonicalMappingCountRows[0]?.count ?? 0);
  if (!apply) {
    counts.products = sourceProducts;
    counts.variants = sourceVariants;
    counts.selections = counts.products;
    counts.canonicalMappings = expectedCanonicalMappings;
    counts.assignments = sourceProducts;
    counts.credentials = ready ? 1 : 0;
    return { ...instance, domain, counts };
  }

  if (ready) {
    const credentialEnvelope = encryptEnvelope({
      authMode: business.shopify_auth_mode === 'client_credentials' ? 'client_credentials' : 'legacy_token',
      shopDomain: domain,
      accessToken: decryptStoredValue(business.shopify_access_token),
      clientId: String(business.shopify_client_id ?? '').trim(),
      clientSecret: decryptStoredValue(business.shopify_client_secret),
      tokenExpiresAt: business.shopify_token_expires_at == null ? null : Number(business.shopify_token_expires_at),
    });
    const [credentialResult] = await connection.query(
      `INSERT IGNORE INTO sales_channel_credentials
         (channel_instance_id, credential_type, encrypted_payload)
       VALUES (?, 'shopify_admin_api', ?)`,
      [instance.channelInstanceId, credentialEnvelope],
    );
    counts.credentials = credentialResult.affectedRows;
  }
  await connection.query(
    `INSERT IGNORE INTO sales_channel_business_roles
       (business_id, role_key, channel_instance_id)
     VALUES (?, 'shopify_customer_value', ?)`,
    [business.business_id, instance.channelInstanceId],
  );
  const [productResult] = await connection.query(
    `INSERT IGNORE INTO \`${business.ims_db_name}\`.ims_channel_product_mappings
       (business_id, channel_instance_id, product_id, external_product_id)
     SELECT p.business_id, ?, p.product_id, p.shopify_product_id
       FROM \`${business.ims_db_name}\`.ims_products p
      WHERE p.business_id = ? AND p.shopify_product_id IS NOT NULL AND p.shopify_product_id <> ''
        AND NOT EXISTS (
          SELECT 1 FROM \`${business.ims_db_name}\`.ims_products duplicate
           WHERE duplicate.business_id = p.business_id
             AND duplicate.shopify_product_id = p.shopify_product_id
             AND duplicate.product_id <> p.product_id
        )`,
    [instance.channelInstanceId, business.business_id],
  );
  counts.products = productResult.affectedRows;
  const [variantResult] = await connection.query(
    `INSERT IGNORE INTO \`${business.ims_db_name}\`.ims_channel_variant_mappings
       (business_id, channel_instance_id, variant_id, external_variant_id, external_inventory_item_id, external_sku)
     SELECT v.business_id, ?, v.variant_id, v.shopify_variant_id, v.shopify_inventory_item_id, v.sku
       FROM \`${business.ims_db_name}\`.ims_product_variants v
      WHERE v.business_id = ? AND v.shopify_variant_id IS NOT NULL AND v.shopify_variant_id <> ''
        AND NOT EXISTS (
          SELECT 1 FROM \`${business.ims_db_name}\`.ims_product_variants duplicate
           WHERE duplicate.business_id = v.business_id
             AND duplicate.shopify_variant_id = v.shopify_variant_id
             AND duplicate.variant_id <> v.variant_id
        )`,
    [instance.channelInstanceId, business.business_id],
  );
  counts.variants = variantResult.affectedRows;
  const [selectionResult] = await connection.query(
    `INSERT IGNORE INTO \`${business.ims_db_name}\`.ims_channel_product_selections
       (business_id, channel_instance_id, product_id, desired_enabled, observed_enabled, publication_status, last_synced_at)
     SELECT business_id, ?, product_id, 1, 1, 'mapped', NOW(3)
       FROM \`${business.ims_db_name}\`.ims_products
      WHERE business_id = ? AND shopify_product_id IS NOT NULL AND shopify_product_id <> ''`,
    [instance.channelInstanceId, business.business_id],
  );
  counts.selections = selectionResult.affectedRows;
  const [canonicalMappingResult] = await connection.query(
    `INSERT IGNORE INTO \`${business.ims_db_name}\`.ims_sales_channel_product_mappings
       (business_id, channel_instance_id, variant_id, external_product_id, external_variant_id,
        external_inventory_id, mapping_status, metadata_json, last_seen_at)
     SELECT variant.business_id, ?, variant.variant_id, product.shopify_product_id,
            variant.shopify_variant_id, variant.shopify_inventory_item_id, 'linked',
            JSON_OBJECT('migrationSource', 'legacy_shopify', 'sku', COALESCE(variant.sku, '')), NOW(3)
       FROM \`${business.ims_db_name}\`.ims_product_variants variant
       JOIN \`${business.ims_db_name}\`.ims_products product
         ON BINARY product.business_id = BINARY variant.business_id AND product.product_id = variant.product_id
      WHERE variant.business_id = ?
        AND product.shopify_product_id IS NOT NULL AND product.shopify_product_id <> ''
        AND variant.shopify_variant_id IS NOT NULL AND variant.shopify_variant_id <> ''
        AND NOT EXISTS (
          SELECT 1 FROM \`${business.ims_db_name}\`.ims_products duplicate
           WHERE BINARY duplicate.business_id = BINARY product.business_id
             AND duplicate.shopify_product_id = product.shopify_product_id
             AND duplicate.product_id <> product.product_id)
        AND NOT EXISTS (
          SELECT 1 FROM \`${business.ims_db_name}\`.ims_product_variants duplicate
           WHERE BINARY duplicate.business_id = BINARY variant.business_id
             AND duplicate.shopify_variant_id = variant.shopify_variant_id
             AND duplicate.variant_id <> variant.variant_id)`,
    [instance.channelInstanceId, business.business_id],
  );
  counts.canonicalMappings = canonicalMappingResult.affectedRows;
  const [assignmentResult] = await connection.query(
    `INSERT IGNORE INTO \`${business.ims_db_name}\`.ims_sales_channel_product_assignments
       (business_id, channel_instance_id, product_id, rule_decision, override_mode, desired_state,
        readiness_status, readiness_issues_json, provider_state, external_product_id, evaluated_at, last_observed_at)
     SELECT product.business_id, ?, product.product_id, 'include', 'include', 'published',
            CASE WHEN EXISTS (
              SELECT 1 FROM \`${business.ims_db_name}\`.ims_products duplicate
               WHERE BINARY duplicate.business_id = BINARY product.business_id
                 AND duplicate.shopify_product_id = product.shopify_product_id
                 AND duplicate.product_id <> product.product_id
            ) OR EXISTS (
              SELECT 1 FROM \`${business.ims_db_name}\`.ims_product_variants variant
              JOIN \`${business.ims_db_name}\`.ims_product_variants duplicate
                ON BINARY duplicate.business_id = BINARY variant.business_id
               AND duplicate.shopify_variant_id = variant.shopify_variant_id
               AND duplicate.variant_id <> variant.variant_id
             WHERE BINARY variant.business_id = BINARY product.business_id
               AND variant.product_id = product.product_id
               AND variant.shopify_variant_id IS NOT NULL AND variant.shopify_variant_id <> ''
            ) THEN 'blocked' ELSE 'ready' END,
            CASE WHEN EXISTS (
              SELECT 1 FROM \`${business.ims_db_name}\`.ims_products duplicate
               WHERE BINARY duplicate.business_id = BINARY product.business_id
                 AND duplicate.shopify_product_id = product.shopify_product_id
                 AND duplicate.product_id <> product.product_id
            ) OR EXISTS (
              SELECT 1 FROM \`${business.ims_db_name}\`.ims_product_variants variant
              JOIN \`${business.ims_db_name}\`.ims_product_variants duplicate
                ON BINARY duplicate.business_id = BINARY variant.business_id
               AND duplicate.shopify_variant_id = variant.shopify_variant_id
               AND duplicate.variant_id <> variant.variant_id
             WHERE BINARY variant.business_id = BINARY product.business_id
               AND variant.product_id = product.product_id
               AND variant.shopify_variant_id IS NOT NULL AND variant.shopify_variant_id <> ''
            ) THEN JSON_ARRAY('Resolve duplicate legacy Shopify IDs before changing publication.') ELSE NULL END,
            'published', product.shopify_product_id, NOW(3), NOW(3)
       FROM \`${business.ims_db_name}\`.ims_products product
      WHERE product.business_id = ? AND product.shopify_product_id IS NOT NULL AND product.shopify_product_id <> ''`,
    [instance.channelInstanceId, business.business_id],
  );
  counts.assignments = assignmentResult.affectedRows;
  await connection.query(
    `DELETE mapping FROM \`${business.ims_db_name}\`.ims_channel_product_mappings mapping
      JOIN \`${business.ims_db_name}\`.ims_products product
        ON product.business_id = mapping.business_id AND product.product_id = mapping.product_id
      JOIN \`${business.ims_db_name}\`.ims_products duplicate
        ON duplicate.business_id = product.business_id
       AND duplicate.shopify_product_id = product.shopify_product_id
       AND duplicate.product_id <> product.product_id
     WHERE mapping.business_id = ? AND mapping.channel_instance_id = ?`,
    [business.business_id, instance.channelInstanceId],
  );
  await connection.query(
    `DELETE mapping FROM \`${business.ims_db_name}\`.ims_channel_variant_mappings mapping
      JOIN \`${business.ims_db_name}\`.ims_product_variants variant
        ON variant.business_id = mapping.business_id AND variant.variant_id = mapping.variant_id
      JOIN \`${business.ims_db_name}\`.ims_product_variants duplicate
        ON duplicate.business_id = variant.business_id
       AND duplicate.shopify_variant_id = variant.shopify_variant_id
       AND duplicate.variant_id <> variant.variant_id
     WHERE mapping.business_id = ? AND mapping.channel_instance_id = ?`,
    [business.business_id, instance.channelInstanceId],
  );
  await connection.query(
    `UPDATE \`${business.ims_db_name}\`.ims_channel_product_selections selection
      JOIN \`${business.ims_db_name}\`.ims_products product
        ON product.business_id = selection.business_id AND product.product_id = selection.product_id
       SET selection.observed_enabled = NULL,
           selection.publication_status = 'mapping_conflict',
           selection.safe_error = 'Legacy Shopify product ID is linked to more than one IMS product.'
     WHERE selection.business_id = ? AND selection.channel_instance_id = ?
       AND EXISTS (
         SELECT 1 FROM \`${business.ims_db_name}\`.ims_products duplicate
          WHERE duplicate.business_id = product.business_id
            AND duplicate.shopify_product_id = product.shopify_product_id
            AND duplicate.product_id <> product.product_id
       )`,
    [business.business_id, instance.channelInstanceId],
  );
  await connection.query(
    `UPDATE \`${business.ims_db_name}\`.ims_channel_product_selections selection
      JOIN \`${business.ims_db_name}\`.ims_product_variants variant
        ON variant.business_id = selection.business_id AND variant.product_id = selection.product_id
       SET selection.observed_enabled = NULL,
           selection.publication_status = 'mapping_conflict',
           selection.safe_error = 'A Shopify variant ID is linked to more than one IMS variant.'
     WHERE selection.business_id = ? AND selection.channel_instance_id = ?
       AND EXISTS (
         SELECT 1 FROM \`${business.ims_db_name}\`.ims_product_variants duplicate
          WHERE duplicate.business_id = variant.business_id
            AND duplicate.shopify_variant_id = variant.shopify_variant_id
            AND duplicate.variant_id <> variant.variant_id
       )`,
    [business.business_id, instance.channelInstanceId],
  );
  const [[mappingRows], [selectionRows], [canonicalMappingRows], [canonicalMismatchRows], [assignmentRows], [credentialRows], [roleRows], [ambiguousProductRows], [ambiguousVariantRows]] = await Promise.all([
    connection.query(
      `SELECT
         (SELECT COUNT(*) FROM \`${business.ims_db_name}\`.ims_channel_product_mappings
           WHERE business_id = ? AND channel_instance_id = ?) AS products,
         (SELECT COUNT(*) FROM \`${business.ims_db_name}\`.ims_channel_variant_mappings
           WHERE business_id = ? AND channel_instance_id = ?) AS variants`,
      [business.business_id, instance.channelInstanceId, business.business_id, instance.channelInstanceId],
    ),
    connection.query(
      `SELECT COUNT(*) AS count FROM \`${business.ims_db_name}\`.ims_channel_product_selections
        WHERE business_id = ? AND channel_instance_id = ?`,
      [business.business_id, instance.channelInstanceId],
    ),
    connection.query(
      `SELECT COUNT(*) AS count FROM \`${business.ims_db_name}\`.ims_sales_channel_product_mappings
        WHERE business_id = ? AND channel_instance_id = ? AND mapping_status = 'linked'`,
      [business.business_id, instance.channelInstanceId],
    ),
    connection.query(
      `SELECT COUNT(*) AS count
         FROM \`${business.ims_db_name}\`.ims_sales_channel_product_mappings mapping
         JOIN \`${business.ims_db_name}\`.ims_product_variants variant
           ON BINARY variant.business_id = BINARY mapping.business_id
          AND BINARY variant.variant_id = BINARY mapping.variant_id
         JOIN \`${business.ims_db_name}\`.ims_products product
           ON BINARY product.business_id = BINARY variant.business_id
          AND BINARY product.product_id = BINARY variant.product_id
        WHERE mapping.business_id = ? AND mapping.channel_instance_id = ? AND mapping.mapping_status = 'linked'
          AND (BINARY mapping.external_product_id <> BINARY product.shopify_product_id
            OR BINARY mapping.external_variant_id <> BINARY variant.shopify_variant_id
            OR NOT (BINARY mapping.external_inventory_id <=> BINARY variant.shopify_inventory_item_id))`,
      [business.business_id, instance.channelInstanceId],
    ),
    connection.query(
      `SELECT COUNT(*) AS count
         FROM \`${business.ims_db_name}\`.ims_sales_channel_product_assignments assignment
         JOIN \`${business.ims_db_name}\`.ims_products product
           ON BINARY product.business_id = BINARY assignment.business_id
          AND BINARY product.product_id = BINARY assignment.product_id
        WHERE assignment.business_id = ? AND assignment.channel_instance_id = ?
          AND product.shopify_product_id IS NOT NULL AND product.shopify_product_id <> ''`,
      [business.business_id, instance.channelInstanceId],
    ),
    connection.query(
      `SELECT COUNT(*) AS count FROM sales_channel_credentials
        WHERE channel_instance_id = ? AND credential_type = 'shopify_admin_api'`,
      [instance.channelInstanceId],
    ),
    connection.query(
      `SELECT COUNT(*) AS count FROM sales_channel_business_roles
        WHERE BINARY business_id = BINARY ? AND role_key = 'shopify_customer_value' AND channel_instance_id = ?`,
      [business.business_id, instance.channelInstanceId],
    ),
    connection.query(
      `SELECT COUNT(*) AS count
         FROM \`${business.ims_db_name}\`.ims_channel_product_mappings mapping
         JOIN \`${business.ims_db_name}\`.ims_products product
           ON product.business_id = mapping.business_id AND product.product_id = mapping.product_id
        WHERE mapping.business_id = ? AND mapping.channel_instance_id = ?
          AND EXISTS (
            SELECT 1 FROM \`${business.ims_db_name}\`.ims_products duplicate
             WHERE duplicate.business_id = product.business_id
               AND duplicate.shopify_product_id = product.shopify_product_id
               AND duplicate.product_id <> product.product_id
          )`,
      [business.business_id, instance.channelInstanceId],
    ),
    connection.query(
      `SELECT COUNT(*) AS count
         FROM \`${business.ims_db_name}\`.ims_channel_variant_mappings mapping
         JOIN \`${business.ims_db_name}\`.ims_product_variants variant
           ON variant.business_id = mapping.business_id AND variant.variant_id = mapping.variant_id
        WHERE mapping.business_id = ? AND mapping.channel_instance_id = ?
          AND EXISTS (
            SELECT 1 FROM \`${business.ims_db_name}\`.ims_product_variants duplicate
             WHERE duplicate.business_id = variant.business_id
               AND duplicate.shopify_variant_id = variant.shopify_variant_id
               AND duplicate.variant_id <> variant.variant_id
          )`,
      [business.business_id, instance.channelInstanceId],
    ),
  ]);
  const verified = {
    products: Number(mappingRows[0]?.products ?? 0),
    variants: Number(mappingRows[0]?.variants ?? 0),
    selections: Number(selectionRows[0]?.count ?? 0),
    canonicalMappings: Number(canonicalMappingRows[0]?.count ?? 0),
    canonicalMismatches: Number(canonicalMismatchRows[0]?.count ?? 0),
    assignments: Number(assignmentRows[0]?.count ?? 0),
    credentials: Number(credentialRows[0]?.count ?? 0),
    primaryRole: Number(roleRows[0]?.count ?? 0),
    ambiguousProducts: Number(ambiguousProductRows[0]?.count ?? 0),
    ambiguousVariants: Number(ambiguousVariantRows[0]?.count ?? 0),
  };
  const expectedProducts = sourceProducts - counts.productConflictOwners;
  const expectedVariants = sourceVariants - counts.variantConflictOwners;
  if (verified.products !== expectedProducts || verified.variants !== expectedVariants
    || verified.selections !== sourceProducts || verified.canonicalMappings !== expectedCanonicalMappings
    || verified.assignments !== sourceProducts || verified.credentials !== (ready ? 1 : 0)
    || verified.primaryRole !== 1 || verified.canonicalMismatches !== 0
    || verified.ambiguousProducts !== 0 || verified.ambiguousVariants !== 0) {
    throw new Error(`Shopify compatibility verification failed for ${business.name}: ${JSON.stringify({
      expectedProducts, expectedVariants, expectedSelections: sourceProducts, expectedCanonicalMappings,
      expectedAssignments: sourceProducts, expectedCredentials: ready ? 1 : 0, verified,
    })}`);
  }
  return { ...instance, domain, counts, verified };
}

async function migrateNative(business) {
  if (!business.native_profile_exists && business.native_shop_enabled !== 1) return null;
  const instance = await ensureInstance({
    businessId: business.business_id,
    provider: 'native_shop',
    displayName: business.native_display_name || 'Solvantis Online Store',
    externalAccountKey: null,
    enabled: business.native_shop_enabled === 1,
    ready: Boolean(business.native_profile_exists),
  });
  const counts = { products: 0, selections: 0 };
  if (!apply) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count FROM \`${business.ims_db_name}\`.ims_online_shop_products WHERE business_id = ?`,
      [business.business_id],
    );
    counts.products = Number(rows[0]?.count ?? 0);
    counts.selections = counts.products;
    return { ...instance, counts };
  }
  const [mappingResult] = await connection.query(
    `INSERT IGNORE INTO \`${business.ims_db_name}\`.ims_channel_product_mappings
       (business_id, channel_instance_id, product_id, external_product_id, external_status, metadata_json, last_synced_at)
     SELECT business_id, ?, product_id, product_id,
            CASE WHEN is_published = 1 THEN 'published' ELSE 'draft' END,
            JSON_OBJECT('slug', slug), updated_at
       FROM \`${business.ims_db_name}\`.ims_online_shop_products
      WHERE business_id = ?`,
    [instance.channelInstanceId, business.business_id],
  );
  counts.products = mappingResult.affectedRows;
  const [selectionResult] = await connection.query(
    `INSERT IGNORE INTO \`${business.ims_db_name}\`.ims_channel_product_selections
       (business_id, channel_instance_id, product_id, desired_enabled, observed_enabled, publication_status, last_synced_at)
     SELECT business_id, ?, product_id, is_published, is_published,
            CASE WHEN is_published = 1 THEN 'published' ELSE 'not_selected' END, updated_at
       FROM \`${business.ims_db_name}\`.ims_online_shop_products
      WHERE business_id = ?`,
    [instance.channelInstanceId, business.business_id],
  );
  counts.selections = selectionResult.affectedRows;
  return { ...instance, counts };
}

try {
  const [businesses] = await connection.query(
    `SELECT b.business_id, b.name, b.ims_db_name,
            c.shopify_shop_id, c.shopify_auth_mode, c.shopify_access_token,
            c.shopify_client_id, c.shopify_client_secret, c.shopify_token_expires_at,
            COALESCE(ch.shopify_enabled, 0) AS shopify_enabled,
            COALESCE(ch.native_shop_enabled, 0) AS native_shop_enabled,
            p.display_name AS native_display_name,
            CASE WHEN p.business_id IS NULL THEN 0 ELSE 1 END AS native_profile_exists
       FROM businesses b
       LEFT JOIN connections c ON BINARY c.business_id = BINARY b.business_id
       LEFT JOIN business_online_channels ch ON BINARY ch.business_id = BINARY b.business_id
       LEFT JOIN online_shop_profiles p ON BINARY p.business_id = BINARY b.business_id
      WHERE b.deleted_at IS NULL AND b.ims_db_name IS NOT NULL AND b.ims_db_name <> ''
        ${requestedBusinessId ? 'AND BINARY b.business_id = BINARY ?' : ''}
      ORDER BY b.name, b.business_id`,
    requestedBusinessId ? [requestedBusinessId] : [],
  );
  if (requestedBusinessId && businesses.length !== 1) {
    throw new Error(`Requested business was not found: ${requestedBusinessId}`);
  }
  console.log(`Sales channel compatibility ${apply ? 'apply' : 'dry run'} for ${businesses.length} businesses:`);
  for (const business of businesses) {
    business.ims_db_name = assertSchemaName(String(business.ims_db_name));
    const shopify = await migrateShopify(business);
    const native = settingsOnly ? null : await migrateNative(business);
    if (!shopify && !native) continue;
    console.log(`  ${business.name}:`);
    if (shopify) console.log(`    Shopify ${shopify.created ? 'instance planned/created' : 'instance exists'}; mappings ${JSON.stringify(shopify.counts)}${shopify.verified ? `; verified ${JSON.stringify(shopify.verified)}` : ''}`);
    if (native) console.log(`    Native ${native.created ? 'instance planned/created' : 'instance exists'}; mappings ${JSON.stringify(native.counts)}`);
  }
  if (!apply) console.log(`Dry run only. Re-run with --apply${settingsOnly ? ' --settings-only' : ''} to apply these changes.`);
} finally {
  await connection.end();
}