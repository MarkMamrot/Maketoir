import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  connectTimeout: 30_000,
});
await conn.query(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    business_id VARCHAR(100) NULL,
    token VARCHAR(128) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_token (token),
    INDEX idx_user_id (user_id)
  )
`);
const [columns] = await conn.query(`
  SELECT COLUMN_NAME FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens'
     AND COLUMN_NAME = 'business_id'
`);
if (columns.length === 0) {
  await conn.query('ALTER TABLE password_reset_tokens ADD COLUMN business_id VARCHAR(100) NULL AFTER user_id');
}
const [verifiedColumns] = await conn.query(`
  SELECT COLUMN_NAME FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens'
     AND COLUMN_NAME = 'business_id'
`);
if (verifiedColumns.length !== 1) throw new Error('password_reset_tokens.business_id verification failed.');
console.log('✓ password_reset_tokens table ready.');
await conn.end();
