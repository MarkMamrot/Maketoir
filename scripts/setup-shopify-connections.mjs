/**
 * Adds Dev Dashboard client-credentials support to tenant Shopify connections.
 * Run: node scripts/setup-shopify-connections.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const columns = [
  ['shopify_auth_mode', "VARCHAR(32) NOT NULL DEFAULT 'legacy_token' AFTER shopify_shop_id"],
  ['shopify_client_id', 'TEXT NULL AFTER shopify_access_token'],
  ['shopify_client_secret', 'TEXT NULL AFTER shopify_client_id'],
  ['shopify_token_expires_at', 'BIGINT NULL AFTER shopify_client_secret'],
];

try {
  for (const [columnName, definition] of columns) {
    const [existing] = await connection.query(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'connections' AND COLUMN_NAME = ? LIMIT 1`,
      [columnName],
    );
    if (existing.length === 0) {
      await connection.query(`ALTER TABLE connections ADD COLUMN ${columnName} ${definition}`);
      console.log(`Added connections.${columnName}`);
    } else {
      console.log(`Already present: connections.${columnName}`);
    }
  }

  const [verified] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'connections'
        AND COLUMN_NAME IN ('shopify_auth_mode', 'shopify_client_id', 'shopify_client_secret', 'shopify_token_expires_at')`,
  );
  if (verified.length !== columns.length) throw new Error('Shopify connection column verification failed.');
  console.log('Shopify connection schema ready.');
} finally {
  await connection.end();
}