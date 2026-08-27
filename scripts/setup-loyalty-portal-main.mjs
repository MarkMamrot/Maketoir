import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const database = process.env.MYSQL_DATABASE;
if (!database) throw new Error('MYSQL_DATABASE is required.');
const schema = await fs.readFile(path.join(process.cwd(), 'scripts', 'marketoir-schema.sql'), 'utf8');
const profileDdl = schema.match(/CREATE TABLE IF NOT EXISTS loyalty_portal_profiles \([\s\S]*?\n\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;/)?.[0];
if (!profileDdl) throw new Error('Canonical loyalty_portal_profiles definition not found.');
const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database });
try {
  const [purposeRows] = await connection.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='online_shop_otp_challenges' AND COLUMN_NAME='purpose'`, [database]);
  console.log(`Loyalty portal main-schema plan for ${database}: profile table and ${purposeRows.length ? 'existing' : 'new'} OTP purpose column.`);
  if (!apply) console.log('Dry run only. Re-run with --apply to make these changes.');
  else {
    await connection.query(profileDdl);
    if (!purposeRows.length) await connection.query("ALTER TABLE online_shop_otp_challenges ADD COLUMN purpose VARCHAR(32) NOT NULL DEFAULT 'native_shop' AFTER contact_id");
    const [indexRows] = await connection.query(`SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columns_list FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='online_shop_otp_challenges' AND INDEX_NAME='idx_online_shop_otp_email_active' GROUP BY INDEX_NAME`, [database]);
    if (indexRows[0]?.columns_list !== 'business_id,purpose,email,consumed_at,expires_at') {
      if (indexRows.length) await connection.query('ALTER TABLE online_shop_otp_challenges DROP INDEX idx_online_shop_otp_email_active');
      await connection.query('ALTER TABLE online_shop_otp_challenges ADD INDEX idx_online_shop_otp_email_active (business_id, purpose, email, consumed_at, expires_at)');
    }
    console.log('Loyalty portal main schema applied successfully.');
  }
} finally { await connection.end(); }