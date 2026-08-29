/**
 * Creates and verifies native online-shop control-plane tables in the main database.
 * Dry-run: node scripts/setup-online-shop-main.mjs
 * Apply:   node scripts/setup-online-shop-main.mjs --apply
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const database = process.env.MYSQL_DATABASE;
if (!database) throw new Error('MYSQL_DATABASE is required.');

const tableContracts = {
  business_online_channels: {
    columns: ['business_id', 'active_channel', 'shopify_enabled', 'native_shop_enabled', 'changed_by_user_id', 'changed_by_name', 'changed_at', 'created_at', 'updated_at'],
    indexes: ['PRIMARY', 'idx_business_online_channels_active', 'idx_business_online_channels_shopify', 'idx_business_online_channels_native'],
  },
  online_shop_profiles: {
    columns: ['business_id', 'slug', 'display_name', 'logo_url', 'support_email', 'default_meta_title', 'default_meta_description', 'is_active', 'created_at', 'updated_at'],
    indexes: ['PRIMARY', 'uq_online_shop_profiles_slug', 'idx_online_shop_profiles_active'],
  },
  online_shop_domains: {
    columns: ['business_id', 'domain_name', 'verification_token', 'status', 'is_active', 'verified_at',
      'last_checked_at', 'safe_error', 'created_at', 'updated_at'],
    indexes: ['PRIMARY', 'uq_online_shop_domain_name', 'idx_online_shop_domain_active'],
  },
  online_shop_layouts: {
    columns: ['business_id', 'schema_version', 'draft_json', 'published_json', 'draft_revision', 'published_revision',
      'draft_updated_by_user_id', 'draft_updated_by_name', 'draft_updated_at', 'published_by_user_id',
      'published_by_name', 'published_at', 'created_at', 'updated_at'],
    indexes: ['PRIMARY'],
  },
  online_shop_assets: {
    columns: ['asset_id', 'business_id', 'stored_filename', 'mime_type', 'byte_size', 'original_name', 'alt_text',
      'created_by_user_id', 'created_by_name', 'is_active', 'created_at'],
    indexes: ['PRIMARY', 'uq_online_shop_asset_file', 'idx_online_shop_assets_active'],
  },
  online_shop_pages: {
    columns: ['page_id', 'business_id', 'slug', 'title', 'meta_title', 'meta_description', 'navigation_location',
      'navigation_label', 'sort_order', 'is_visible', 'schema_version', 'draft_json', 'published_json',
      'draft_revision', 'published_revision', 'draft_updated_by_user_id', 'draft_updated_by_name', 'draft_updated_at',
      'published_by_user_id', 'published_by_name', 'published_at', 'created_at', 'updated_at'],
    indexes: ['PRIMARY', 'uq_online_shop_page_slug', 'idx_online_shop_pages_navigation'],
  },
  online_shop_otp_challenges: {
    columns: ['id', 'business_id', 'email', 'contact_id', 'challenge_token_hash', 'code_hash', 'attempt_count',
      'expires_at', 'consumed_at', 'verified_at', 'created_at'],
    indexes: ['PRIMARY', 'uq_online_shop_otp_token', 'idx_online_shop_otp_email_active', 'idx_online_shop_otp_expiry'],
  },
  online_shop_stripe_connections: {
    columns: ['business_id', 'stripe_account_id', 'charges_enabled', 'payouts_enabled', 'details_submitted',
      'connected_by_user_id', 'connected_at', 'updated_at'],
    indexes: ['PRIMARY', 'uq_online_shop_stripe_account', 'idx_online_shop_stripe_ready'],
  },
};

function extractDefinition(schema, table) {
  const expression = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  const match = schema.match(expression);
  if (!match) throw new Error(`Canonical definition not found for ${table}.`);
  return match[0];
}

const schema = await fs.readFile(path.join(process.cwd(), 'scripts', 'marketoir-schema.sql'), 'utf8');
const definitions = Object.fromEntries(Object.keys(tableContracts).map(table => [table, extractDefinition(schema, table)]));
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database,
});

try {
  const tables = Object.keys(tableContracts);
  const [existingRows] = await connection.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
    [database, tables],
  );
  const existing = new Set(existingRows.map(row => row.TABLE_NAME));
  const pending = tables.filter(table => !existing.has(table));
  console.log(`Online shop main-schema plan for ${database}:`);
  console.log(`  tables to create: ${pending.join(', ') || 'none'}`);

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to make these changes.');
    if (pending.length > 0) process.exitCode = 0;
  } else {
    for (const definition of Object.values(definitions)) await connection.query(definition);
    const [channelColumnRows] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'business_online_channels'`,
      [database],
    );
    const channelColumns = new Set(channelColumnRows.map(row => row.COLUMN_NAME));
    const addedShopifyEnabled = !channelColumns.has('shopify_enabled');
    const addedNativeShopEnabled = !channelColumns.has('native_shop_enabled');
    if (addedShopifyEnabled) {
      await connection.query(`ALTER TABLE business_online_channels
        ADD COLUMN shopify_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER active_channel`);
    }
    if (addedNativeShopEnabled) {
      await connection.query(`ALTER TABLE business_online_channels
        ADD COLUMN native_shop_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER shopify_enabled`);
    }
    await connection.query(`UPDATE business_online_channels
      SET shopify_enabled = CASE WHEN active_channel = 'shopify' THEN 1 ELSE shopify_enabled END,
          native_shop_enabled = CASE WHEN active_channel = 'native_shop' THEN 1 ELSE native_shop_enabled END`);
    await connection.query(`INSERT INTO business_online_channels
      (business_id, active_channel, shopify_enabled, native_shop_enabled)
      SELECT b.business_id,
             CASE
               WHEN c.shopify_shop_id IS NOT NULL AND TRIM(c.shopify_shop_id) <> '' THEN 'shopify'
               WHEN p.is_active = 1 THEN 'native_shop'
               ELSE 'none'
             END,
             CASE WHEN c.shopify_shop_id IS NOT NULL AND TRIM(c.shopify_shop_id) <> '' THEN 1 ELSE 0 END,
             CASE WHEN p.is_active = 1 THEN 1 ELSE 0 END
        FROM businesses b
        LEFT JOIN connections c ON c.business_id = b.business_id
        LEFT JOIN online_shop_profiles p ON p.business_id = b.business_id
        LEFT JOIN business_online_channels channels ON channels.business_id = b.business_id
       WHERE channels.business_id IS NULL`);
    if (addedShopifyEnabled) {
      await connection.query(`UPDATE business_online_channels channels
        JOIN connections c ON c.business_id = channels.business_id
         SET channels.shopify_enabled = 1
       WHERE c.shopify_shop_id IS NOT NULL AND TRIM(c.shopify_shop_id) <> ''`);
    }
    if (addedNativeShopEnabled) {
      await connection.query(`UPDATE business_online_channels channels
        JOIN online_shop_profiles p ON p.business_id = channels.business_id
         SET channels.native_shop_enabled = 1
       WHERE p.is_active = 1`);
    }
    const [channelIndexRows] = await connection.query(
      `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'business_online_channels'`,
      [database],
    );
    const channelIndexes = new Set(channelIndexRows.map(row => row.INDEX_NAME));
    if (!channelIndexes.has('idx_business_online_channels_shopify')) {
      await connection.query('CREATE INDEX idx_business_online_channels_shopify ON business_online_channels (shopify_enabled, business_id)');
    }
    if (!channelIndexes.has('idx_business_online_channels_native')) {
      await connection.query('CREATE INDEX idx_business_online_channels_native ON business_online_channels (native_shop_enabled, business_id)');
    }
    console.log('Online shop main schema applied successfully.');
  }

  if (apply || pending.length === 0) {
    const [columnRows] = await connection.query(
      `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
      [database, tables],
    );
    const [indexRows] = await connection.query(
      `SELECT DISTINCT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
      [database, tables],
    );
    const columns = new Set(columnRows.map(row => `${row.TABLE_NAME}:${row.COLUMN_NAME}`));
    const indexes = new Set(indexRows.map(row => `${row.TABLE_NAME}:${row.INDEX_NAME}`));
    const missingColumns = Object.entries(tableContracts).flatMap(([table, contract]) =>
      contract.columns.filter(column => !columns.has(`${table}:${column}`)).map(column => `${table}.${column}`));
    const missingIndexes = Object.entries(tableContracts).flatMap(([table, contract]) =>
      contract.indexes.filter(index => !indexes.has(`${table}:${index}`)).map(index => `${table}.${index}`));
    if (missingColumns.length || missingIndexes.length) {
      throw new Error(`Online shop schema verification failed: ${JSON.stringify({ missingColumns, missingIndexes })}`);
    }
    console.log(`Verified ${columns.size} columns and ${indexes.size} indexes across ${tables.length} tables.`);
  }
} finally {
  await connection.end();
}