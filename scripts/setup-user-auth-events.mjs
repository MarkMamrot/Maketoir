/**
 * Creates/upgrades the 12-month platform authentication activity store.
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
      user_id INT NULL,
      event_type ENUM('login_success','login_failure','login_lockout','password_renewal_required','mfa_failure','mfa_enrolled','mfa_recovery_used','mfa_trust_used','password_reset_requested','password_reset_completed') NOT NULL,
      actor_user_id INT NULL,
      ip_address VARCHAR(45) NULL,
      city VARCHAR(100) NULL,
      region VARCHAR(100) NULL,
      country CHAR(2) NULL,
      user_agent VARCHAR(500) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_user_auth_events_user_created (user_id, created_at),
      INDEX idx_user_auth_events_retention (created_at),
      CONSTRAINT fk_user_auth_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_user_auth_events_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [eventColumns] = await connection.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'user_auth_events' AND COLUMN_NAME IN ('user_id', 'event_type')`,
      [database],
    );
    const eventType = "enum('login_success','login_failure','login_lockout','password_renewal_required','mfa_failure','mfa_enrolled','mfa_recovery_used','mfa_trust_used','password_reset_requested','password_reset_completed')";
    if (eventColumns.find(row => row.COLUMN_NAME === 'user_id')?.IS_NULLABLE !== 'YES') {
      await connection.query('ALTER TABLE user_auth_events MODIFY COLUMN user_id INT NULL');
    }
    if (eventColumns.find(row => row.COLUMN_NAME === 'event_type')?.COLUMN_TYPE !== eventType) {
      await connection.query(`ALTER TABLE user_auth_events MODIFY COLUMN event_type ${eventType} NOT NULL`);
    }
    const [foreignKeys] = await connection.query(
      `SELECT CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'user_auth_events'`,
      [database],
    );
    for (const [name, column] of [['fk_user_auth_events_user', 'user_id'], ['fk_user_auth_events_actor', 'actor_user_id']]) {
      const existing = foreignKeys.find(row => row.CONSTRAINT_NAME === name);
      if (existing?.DELETE_RULE === 'RESTRICT' || existing?.DELETE_RULE === 'NO ACTION') continue;
      if (existing) await connection.query(`ALTER TABLE user_auth_events DROP FOREIGN KEY \`${name}\``);
      await connection.query(`ALTER TABLE user_auth_events ADD CONSTRAINT \`${name}\` FOREIGN KEY (\`${column}\`) REFERENCES users(id) ON DELETE RESTRICT`);
    }
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