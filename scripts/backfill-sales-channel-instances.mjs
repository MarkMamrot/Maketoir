/**
 * Backfills the channel-instance foundation from legacy Shopify and Native Shop state.
 * Dry-run: node scripts/backfill-sales-channel-instances.mjs
 * Apply:   node scripts/backfill-sales-channel-instances.mjs --apply
 */
import 'dotenv/config';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
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

async function migrateShopify(business) {
  const domain = normalizeShopifyDomain(business.shopify_shop_id);
  if (!domain) return null;
  const ready = hasShopifyCredentials(business);
  const instance = await ensureInstance({
    businessId: business.business_id,
    provider: 'shopify',
    displayName: `${business.name} Shopify`,
    externalAccountKey: domain,
    enabled: business.shopify_enabled === 1,
    ready,
  });
  const counts = { products: 0, variants: 0, selections: 0, credentials: 0, productConflictOwners: 0, variantConflictOwners: 0 };
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
  const [[productCountRows], [variantCountRows]] = await Promise.all([
    connection.query(`SELECT COUNT(*) AS count FROM \`${business.ims_db_name}\`.ims_products
      WHERE business_id = ? AND shopify_product_id IS NOT NULL AND shopify_product_id <> ''`, [business.business_id]),
    connection.query(`SELECT COUNT(*) AS count FROM \`${business.ims_db_name}\`.ims_product_variants
      WHERE business_id = ? AND shopify_variant_id IS NOT NULL AND shopify_variant_id <> ''`, [business.business_id]),
  ]);
  const sourceProducts = Number(productCountRows[0]?.count ?? 0);
  const sourceVariants = Number(variantCountRows[0]?.count ?? 0);
  if (!apply) {
    counts.products = sourceProducts;
    counts.variants = sourceVariants;
    counts.selections = counts.products;
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
  const [[mappingRows], [selectionRows], [credentialRows], [roleRows], [ambiguousProductRows], [ambiguousVariantRows]] = await Promise.all([
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
    credentials: Number(credentialRows[0]?.count ?? 0),
    primaryRole: Number(roleRows[0]?.count ?? 0),
    ambiguousProducts: Number(ambiguousProductRows[0]?.count ?? 0),
    ambiguousVariants: Number(ambiguousVariantRows[0]?.count ?? 0),
  };
  const expectedProducts = sourceProducts - counts.productConflictOwners;
  const expectedVariants = sourceVariants - counts.variantConflictOwners;
  if (verified.products !== expectedProducts || verified.variants !== expectedVariants
    || verified.selections !== sourceProducts || verified.credentials !== (ready ? 1 : 0)
    || verified.primaryRole !== 1 || verified.ambiguousProducts !== 0 || verified.ambiguousVariants !== 0) {
    throw new Error(`Shopify compatibility verification failed for ${business.name}: ${JSON.stringify({
      expectedProducts, expectedVariants, expectedSelections: sourceProducts, expectedCredentials: ready ? 1 : 0, verified,
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
      ORDER BY b.name, b.business_id`,
  );
  console.log(`Sales channel compatibility ${apply ? 'apply' : 'dry run'} for ${businesses.length} businesses:`);
  for (const business of businesses) {
    business.ims_db_name = assertSchemaName(String(business.ims_db_name));
    const shopify = await migrateShopify(business);
    const native = await migrateNative(business);
    if (!shopify && !native) continue;
    console.log(`  ${business.name}:`);
    if (shopify) console.log(`    Shopify ${shopify.created ? 'instance planned/created' : 'instance exists'}; mappings ${JSON.stringify(shopify.counts)}${shopify.verified ? `; verified ${JSON.stringify(shopify.verified)}` : ''}`);
    if (native) console.log(`    Native ${native.created ? 'instance planned/created' : 'instance exists'}; mappings ${JSON.stringify(native.counts)}`);
  }
  if (!apply) console.log('Dry run only. Re-run with --apply to create instances and mappings.');
} finally {
  await connection.end();
}