/**
 * Adds the 90-day user authentication activity store to the shared main database.
 * Dry-run: node scripts/setup-user-auth-events.mjs
 * Apply:   node scripts/setup-user-auth-events.mjs --apply
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const database = process.env.MYSQL_DATABASE;
if (!database) throw new Error('MYSQL_DATABASE is required.');

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database,
  connectTimeout: 30_000,
});

try {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'user_auth_events'`,
    [database],
  );
  console.log(`User authentication activity schema for ${database}: ${rows.length ? 'ready' : 'create table'}`);
  if (!apply) {
    console.log('Dry run only. Re-run with --apply to make this change.');
  } else {
    await connection.query(`CREATE TABLE IF NOT EXISTS user_auth_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      business_id VARCHAR(100) NULL,
      user_id INT NOT NULL,
      event_type ENUM('login_success','password_reset_requested','password_reset_completed') NOT NULL,
      actor_user_id INT NULL,
      ip_address VARCHAR(45) NULL,
      city VARCHAR(100) NULL,
      region VARCHAR(100) NULL,
      country CHAR(2) NULL,
      user_agent VARCHAR(500) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_user_auth_events_user_created (user_id, created_at),
      INDEX idx_user_auth_events_retention (created_at),
      CONSTRAINT fk_user_auth_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_auth_events_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const requiredColumns = ['id', 'business_id', 'user_id', 'event_type', 'actor_user_id', 'ip_address', 'city', 'region', 'country', 'user_agent', 'created_at'];
    const requiredIndexes = ['PRIMARY', 'idx_user_auth_events_user_created', 'idx_user_auth_events_retention'];
    const [columns] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'user_auth_events'`,
      [database],
    );
    const [indexes] = await connection.query(
      `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'user_auth_events'`,
      [database],
    );
    const columnNames = new Set(columns.map(row => row.COLUMN_NAME));
    const indexNames = new Set(indexes.map(row => row.INDEX_NAME));
    const missingColumns = requiredColumns.filter(name => !columnNames.has(name));
    const missingIndexes = requiredIndexes.filter(name => !indexNames.has(name));
    if (missingColumns.length || missingIndexes.length) {
      throw new Error(`Authentication activity schema verification failed. Missing columns: ${missingColumns.join(', ') || 'none'}; indexes: ${missingIndexes.join(', ') || 'none'}.`);
    }
    console.log(`User authentication activity schema is ready (${requiredColumns.length} columns, ${requiredIndexes.length} indexes).`);
  }
} finally {
  await connection.end();
}