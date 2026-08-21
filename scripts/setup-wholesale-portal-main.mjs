/**
 * Adds wholesale public-profile and authentication control-plane state to the main database.
 * Dry-run: node scripts/setup-wholesale-portal-main.mjs
 * Apply:   node scripts/setup-wholesale-portal-main.mjs --apply
 */
import 'dotenv/config';
import crypto from 'crypto';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const database = process.env.MYSQL_DATABASE;

if (!database) {
  throw new Error('MYSQL_DATABASE is required.');
}

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database,
});

const tableDefinitions = {
  wholesale_supplier_profiles: `CREATE TABLE IF NOT EXISTS wholesale_supplier_profiles (
  business_id VARCHAR(100) PRIMARY KEY,
  slug VARCHAR(80) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  logo_url VARCHAR(2048) NULL,
  support_email VARCHAR(320) NULL,
  application_heading VARCHAR(255) NULL,
  application_intro TEXT NULL,
  terms_url VARCHAR(2048) NULL,
  privacy_url VARCHAR(2048) NULL,
  theme_json JSON NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wholesale_supplier_profiles_slug (slug),
  INDEX idx_wholesale_supplier_profiles_active (is_active, slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  wholesale_otp_challenges: `CREATE TABLE IF NOT EXISTS wholesale_otp_challenges (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  contact_id INT NOT NULL,
  email VARCHAR(320) NOT NULL,
  challenge_token_hash CHAR(64) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wholesale_otp_challenge_token (challenge_token_hash),
  INDEX idx_wholesale_otp_contact_active (business_id, contact_id, consumed_at, expires_at),
  INDEX idx_wholesale_otp_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
};

const requiredColumns = {
  wholesale_supplier_profiles: [
    'business_id', 'slug', 'display_name', 'logo_url', 'support_email',
    'application_heading', 'application_intro', 'terms_url', 'privacy_url',
    'theme_json', 'is_active', 'created_at', 'updated_at',
  ],
  wholesale_otp_challenges: [
    'id', 'business_id', 'contact_id', 'email', 'challenge_token_hash',
    'code_hash', 'attempt_count', 'expires_at', 'consumed_at', 'verified_at', 'created_at',
  ],
};

const requiredIndexes = {
  wholesale_supplier_profiles: [
    'PRIMARY', 'uq_wholesale_supplier_profiles_slug', 'idx_wholesale_supplier_profiles_active',
  ],
  wholesale_otp_challenges: [
    'PRIMARY', 'uq_wholesale_otp_challenge_token', 'idx_wholesale_otp_contact_active',
    'idx_wholesale_otp_expiry',
  ],
};

function normalizeSlug(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

async function loadWholesaleEnabled(imsDbName, businessId) {
  if (!imsDbName) return false;
  const imsConnection = await mysql.createConnection({
    host: process.env.IMS_MYSQL_HOST || process.env.MYSQL_HOST,
    port: Number(process.env.IMS_MYSQL_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.IMS_MYSQL_USER || process.env.MYSQL_USER,
    password: process.env.IMS_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD,
    database: imsDbName,
  });
  try {
    const [rows] = await imsConnection.query(
      `SELECT value FROM ims_settings
        WHERE business_id = ? AND \`key\` = 'sells_wholesale'
        LIMIT 1`,
      [businessId],
    );
    return String(rows[0]?.value ?? 'yes').trim().toLowerCase() !== 'no';
  } finally {
    await imsConnection.end();
  }
}

async function seedSupplierProfiles() {
  const [businesses] = await connection.query(
    `SELECT b.business_id, b.name, b.ims_db_name, bp.logo_url
       FROM businesses b
       LEFT JOIN brand_profile bp ON BINARY bp.business_id = BINARY b.business_id
      WHERE b.deleted_at IS NULL
      ORDER BY b.created_at, b.business_id`,
  );
  const [profiles] = await connection.query(
    'SELECT business_id, slug FROM wholesale_supplier_profiles',
  );
  const profileByBusiness = new Map(profiles.map(row => [row.business_id, row]));
  const slugOwners = new Map(profiles.map(row => [row.slug, row.business_id]));
  let seeded = 0;
  let deactivated = 0;
  let skipped = 0;

  for (const business of businesses) {
    const enabled = await loadWholesaleEnabled(business.ims_db_name, business.business_id);
    const existing = profileByBusiness.get(business.business_id);
    if (!enabled) {
      if (existing) {
        await connection.query(
          'UPDATE wholesale_supplier_profiles SET is_active = 0 WHERE business_id = ?',
          [business.business_id],
        );
        deactivated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    let slug = existing?.slug || normalizeSlug(business.name);
    if (slug.length < 3) slug = `supplier-${crypto.createHash('sha256').update(business.business_id).digest('hex').slice(0, 8)}`;
    const owner = slugOwners.get(slug);
    if (owner && owner !== business.business_id) {
      const suffix = crypto.createHash('sha256').update(business.business_id).digest('hex').slice(0, 8);
      slug = `${slug.slice(0, 71).replace(/-+$/g, '')}-${suffix}`;
    }

    await connection.query(
      `INSERT INTO wholesale_supplier_profiles
         (business_id, slug, display_name, logo_url, is_active)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         logo_url = COALESCE(VALUES(logo_url), logo_url),
         is_active = 1,
         updated_at = CURRENT_TIMESTAMP(3)`,
      [business.business_id, slug, business.name, business.logo_url || null],
    );
    slugOwners.set(slug, business.business_id);
    seeded += 1;
  }

  console.log(`Supplier profile seed: ${seeded} enabled, ${deactivated} deactivated, ${skipped} disabled/unmapped skipped.`);
}

try {
  const [existingTables] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
    [database, Object.keys(tableDefinitions)],
  );
  const existingTableNames = new Set(existingTables.map(row => row.TABLE_NAME));
  const pendingTables = Object.keys(tableDefinitions).filter(name => !existingTableNames.has(name));

  console.log(`Wholesale portal main-schema plan for ${database}:`);
  console.log(`  tables to create: ${pendingTables.join(', ') || 'none'}`);

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to make these changes.');
  } else {
    for (const definition of Object.values(tableDefinitions)) {
      await connection.query(definition);
    }
    console.log('Wholesale portal main schema applied successfully.');
  }

  if (apply || pendingTables.length === 0) {
    const [columns] = await connection.query(
      `SELECT TABLE_NAME, COLUMN_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
      [database, Object.keys(tableDefinitions)],
    );
    const columnNames = new Set(columns.map(row => `${row.TABLE_NAME}:${row.COLUMN_NAME}`));

    const [indexes] = await connection.query(
      `SELECT DISTINCT TABLE_NAME, INDEX_NAME
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
      [database, Object.keys(tableDefinitions)],
    );
    const indexNames = new Set(indexes.map(row => `${row.TABLE_NAME}:${row.INDEX_NAME}`));

    const missingColumns = Object.entries(requiredColumns).flatMap(([table, names]) =>
      names.filter(name => !columnNames.has(`${table}:${name}`)).map(name => `${table}.${name}`),
    );
    const missingIndexes = Object.entries(requiredIndexes).flatMap(([table, names]) =>
      names.filter(name => !indexNames.has(`${table}:${name}`)).map(name => `${table}.${name}`),
    );
    if (missingColumns.length || missingIndexes.length) {
      throw new Error(`Wholesale portal schema verification failed: ${JSON.stringify({
        missingColumns,
        missingIndexes,
      })}`);
    }

    console.log(`Verified ${columnNames.size} columns and ${indexNames.size} indexes across ${Object.keys(tableDefinitions).length} tables.`);
    if (apply) await seedSupplierProfiles();
  }
} finally {
  await connection.end();
}