/**
 * Adds global MFA security state to the shared main database.
 * Dry-run: node scripts/setup-mfa-security.mjs
 * Apply:   node scripts/setup-mfa-security.mjs --apply
 */
import 'dotenv/config';
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

const userColumns = [
  ['mfa_totp_secret', 'VARCHAR(255) NULL'],
  ['mfa_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['mfa_enabled_at', 'DATETIME(3) NULL'],
  ['mfa_last_totp_step', 'BIGINT NULL'],
];

const tableDefinitions = {
  mfa_recovery_codes: `CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    code_hash CHAR(64) NOT NULL,
    consumed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_mfa_recovery_user_hash (user_id, code_hash),
    INDEX idx_mfa_recovery_user_available (user_id, consumed_at),
    CONSTRAINT fk_mfa_recovery_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  mfa_preauth_sessions: `CREATE TABLE IF NOT EXISTS mfa_preauth_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    purpose ENUM('enroll','challenge') NOT NULL,
    destination VARCHAR(32) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
    consumed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_mfa_preauth_token_hash (token_hash),
    INDEX idx_mfa_preauth_user_active (user_id, consumed_at, expires_at),
    INDEX idx_mfa_preauth_expiry (expires_at),
    CONSTRAINT fk_mfa_preauth_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  mfa_trusted_browsers: `CREATE TABLE IF NOT EXISTS mfa_trusted_browsers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    display_label VARCHAR(191) NOT NULL,
    issued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3) NOT NULL,
    last_used_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    revoked_at DATETIME(3) NULL,
    UNIQUE KEY uq_mfa_trusted_token_hash (token_hash),
    INDEX idx_mfa_trusted_user_active (user_id, revoked_at, expires_at),
    CONSTRAINT fk_mfa_trusted_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  auth_rate_limits: `CREATE TABLE IF NOT EXISTS auth_rate_limits (
    action VARCHAR(64) NOT NULL,
    subject_hash CHAR(64) NOT NULL,
    failure_count INT UNSIGNED NOT NULL DEFAULT 0,
    window_started_at DATETIME(3) NOT NULL,
    locked_until DATETIME(3) NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (action, subject_hash),
    INDEX idx_auth_rate_limits_locked (locked_until)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
};

const requiredIndexes = [
  ['mfa_recovery_codes', 'uq_mfa_recovery_user_hash'],
  ['mfa_recovery_codes', 'idx_mfa_recovery_user_available'],
  ['mfa_preauth_sessions', 'uq_mfa_preauth_token_hash'],
  ['mfa_preauth_sessions', 'idx_mfa_preauth_user_active'],
  ['mfa_preauth_sessions', 'idx_mfa_preauth_expiry'],
  ['mfa_trusted_browsers', 'uq_mfa_trusted_token_hash'],
  ['mfa_trusted_browsers', 'idx_mfa_trusted_user_active'],
  ['auth_rate_limits', 'PRIMARY'],
  ['auth_rate_limits', 'idx_auth_rate_limits_locked'],
];

try {
  const [existingColumns] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
    [database],
  );
  const columnNames = new Set(existingColumns.map(row => row.COLUMN_NAME));

  const [existingTables] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
    [database, Object.keys(tableDefinitions)],
  );
  const tableNames = new Set(existingTables.map(row => row.TABLE_NAME));

  const pendingColumns = userColumns.filter(([name]) => !columnNames.has(name));
  const pendingTables = Object.keys(tableDefinitions).filter(name => !tableNames.has(name));

  console.log(`MFA security schema plan for ${database}:`);
  console.log(`  users columns to add: ${pendingColumns.map(([name]) => name).join(', ') || 'none'}`);
  console.log(`  tables to create: ${pendingTables.join(', ') || 'none'}`);

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to make these changes.');
  } else {
    for (const [name, definition] of pendingColumns) {
      await connection.query(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
    }
    for (const definition of Object.values(tableDefinitions)) {
      await connection.query(definition);
    }
    console.log('MFA security schema applied successfully.');
  }

  if (apply || (pendingColumns.length === 0 && pendingTables.length === 0)) {
    const [verifiedColumns] = await connection.query(
      `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME IN (?)`,
      [database, userColumns.map(([name]) => name)],
    );
    const verifiedColumnNames = new Set(verifiedColumns.map(row => row.COLUMN_NAME));

    const [verifiedTables] = await connection.query(
      `SELECT TABLE_NAME
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
      [database, Object.keys(tableDefinitions)],
    );
    const verifiedTableNames = new Set(verifiedTables.map(row => row.TABLE_NAME));

    const [verifiedIndexes] = await connection.query(
      `SELECT TABLE_NAME, INDEX_NAME
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
      [database, Object.keys(tableDefinitions)],
    );
    const verifiedIndexNames = new Set(
      verifiedIndexes.map(row => `${row.TABLE_NAME}:${row.INDEX_NAME}`),
    );

    const missingColumns = userColumns
      .map(([name]) => name)
      .filter(name => !verifiedColumnNames.has(name));
    const missingTables = Object.keys(tableDefinitions)
      .filter(name => !verifiedTableNames.has(name));
    const missingIndexes = requiredIndexes
      .filter(([table, index]) => !verifiedIndexNames.has(`${table}:${index}`))
      .map(([table, index]) => `${table}.${index}`);

    if (missingColumns.length || missingTables.length || missingIndexes.length) {
      throw new Error(`MFA schema verification failed: ${JSON.stringify({
        missingColumns,
        missingTables,
        missingIndexes,
      })}`);
    }
    console.log(`Verified ${userColumns.length} users columns, ${Object.keys(tableDefinitions).length} tables, and ${requiredIndexes.length} required indexes.`);
  }
} finally {
  await connection.end();
}