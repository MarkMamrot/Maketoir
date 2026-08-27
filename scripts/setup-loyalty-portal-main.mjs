import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const database = process.env.MYSQL_DATABASE;
if (!database) throw new Error('MYSQL_DATABASE is required.');
const schema = await fs.readFile(path.join(process.cwd(), 'scripts', 'marketoir-schema.sql'), 'utf8');
const profileDdl = schema.match(/CREATE TABLE IF NOT EXISTS loyalty_portal_profiles \([\s\S]*?\n\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;/)?.[0];
const policyVersionsDdl = schema.match(/CREATE TABLE IF NOT EXISTS loyalty_policy_versions \([\s\S]*?\n\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;/)?.[0];
if (!profileDdl) throw new Error('Canonical loyalty_portal_profiles definition not found.');
if (!policyVersionsDdl) throw new Error('Canonical loyalty_policy_versions definition not found.');
const profileColumns = [
  ['policy_mode', "VARCHAR(20) NOT NULL DEFAULT 'external'"],
  ['legal_name', 'VARCHAR(255) NULL'],
  ['trading_name', 'VARCHAR(255) NULL'],
  ['business_number', 'VARCHAR(100) NULL'],
  ['policy_contact_email', 'VARCHAR(320) NULL'],
  ['policy_contact_address', 'VARCHAR(1000) NULL'],
  ['policy_jurisdiction', 'VARCHAR(100) NULL'],
  ['current_policy_version_id', 'BIGINT UNSIGNED NULL'],
];
const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database });
try {
  const [purposeRows] = await connection.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='online_shop_otp_challenges' AND COLUMN_NAME='purpose'`, [database]);
  const [existingProfileColumns] = await connection.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='loyalty_portal_profiles'`, [database]);
  const existingNames = new Set(existingProfileColumns.map(row => row.COLUMN_NAME));
  const missingProfileColumns = profileColumns.filter(([name]) => !existingNames.has(name));
  console.log(`Loyalty portal main-schema plan for ${database}: ${missingProfileColumns.length} profile column(s), policy versions table, and ${purposeRows.length ? 'existing' : 'new'} OTP purpose column.`);
  if (!apply) console.log('Dry run only. Re-run with --apply to make these changes.');
  else {
    await connection.query(profileDdl);
    const [createdProfileColumns] = await connection.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='loyalty_portal_profiles'`, [database]);
    const createdNames = new Set(createdProfileColumns.map(row => row.COLUMN_NAME));
    for (const [name, definition] of profileColumns.filter(([columnName]) => !createdNames.has(columnName))) {
      await connection.query(`ALTER TABLE loyalty_portal_profiles ADD COLUMN \`${name}\` ${definition}`);
    }
    await connection.query(policyVersionsDdl);
    await connection.query(`INSERT INTO loyalty_policy_versions
      (business_id, version, policy_mode, terms_url, privacy_url, content_hash, approved_by_user_id, approved_by_name)
      SELECT p.business_id, p.terms_version, 'external', p.terms_url, p.privacy_url,
             SHA2(CONCAT('legacy-external|', p.terms_version, '|', p.terms_url, '|', p.privacy_url), 256),
             0, 'Legacy migration'
        FROM loyalty_portal_profiles p
       WHERE p.current_policy_version_id IS NULL
      ON DUPLICATE KEY UPDATE id=id`);
    await connection.query(`UPDATE loyalty_portal_profiles p
      JOIN loyalty_policy_versions v ON BINARY v.business_id=BINARY p.business_id AND v.version=p.terms_version
       SET p.current_policy_version_id=v.id
     WHERE p.current_policy_version_id IS NULL`);
    if (!purposeRows.length) await connection.query("ALTER TABLE online_shop_otp_challenges ADD COLUMN purpose VARCHAR(32) NOT NULL DEFAULT 'native_shop' AFTER contact_id");
    const [indexRows] = await connection.query(`SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columns_list FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='online_shop_otp_challenges' AND INDEX_NAME='idx_online_shop_otp_email_active' GROUP BY INDEX_NAME`, [database]);
    if (indexRows[0]?.columns_list !== 'business_id,purpose,email,consumed_at,expires_at') {
      if (indexRows.length) await connection.query('ALTER TABLE online_shop_otp_challenges DROP INDEX idx_online_shop_otp_email_active');
      await connection.query('ALTER TABLE online_shop_otp_challenges ADD INDEX idx_online_shop_otp_email_active (business_id, purpose, email, consumed_at, expires_at)');
    }
    const [policyColumns] = await connection.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='loyalty_policy_versions'`, [database]);
    if (policyColumns.length !== 14) throw new Error(`Expected 14 loyalty_policy_versions columns, found ${policyColumns.length}.`);
    console.log('Loyalty portal main schema applied successfully.');
  }
} finally { await connection.end(); }