/**
 * Creates/upgrades the 12-month platform authentication activity store.
 * Dry-run: node scripts/setup-user-auth-events.mjs
 * Apply:   node scripts/setup-user-auth-events.mjs --apply
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const guards = JSON.parse(readFileSync(new URL('./platform-security-guards.json', import.meta.url), 'utf8'))
  .filter(guard => guard.table === 'user_auth_events');

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
  console.log(`User authentication activity schema for ${database}: ${rows.length ? 'existing table; upgrade checks required' : 'create table'}`);
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
      CONSTRAINT fk_user_auth_events_retained_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_user_auth_events_retained_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
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
      const currentType = eventColumns.find(row => row.COLUMN_NAME === 'event_type')?.COLUMN_TYPE;
      const currentValues = currentType?.startsWith("enum('") ? currentType.slice(6, -2).split("','") : null;
      if (!currentValues || currentValues.some(value => !eventType.includes(`'${value}'`))) {
        throw new Error('Unexpected existing authentication event type; review it before changing the enum.');
      }
      await connection.query(`ALTER TABLE user_auth_events MODIFY COLUMN event_type ${eventType} NOT NULL`);
    }
    const [foreignKeys] = await connection.query(
      `SELECT r.CONSTRAINT_NAME, r.DELETE_RULE, k.COLUMN_NAME
         FROM information_schema.REFERENTIAL_CONSTRAINTS r
         JOIN information_schema.KEY_COLUMN_USAGE k ON k.CONSTRAINT_SCHEMA = r.CONSTRAINT_SCHEMA
          AND k.CONSTRAINT_NAME = r.CONSTRAINT_NAME AND k.TABLE_NAME = r.TABLE_NAME
        WHERE r.CONSTRAINT_SCHEMA = ? AND r.TABLE_NAME = 'user_auth_events' AND k.REFERENCED_TABLE_NAME = 'users'`,
      [database],
    );
    for (const [name, column] of [['fk_user_auth_events_retained_user', 'user_id'], ['fk_user_auth_events_retained_actor', 'actor_user_id']]) {
      const matches = foreignKeys.filter(row => row.COLUMN_NAME === column);
      if (matches.length > 1) throw new Error('Unexpected duplicate authentication activity foreign keys; review them before migration.');
      const existing = matches[0];
      if (existing?.DELETE_RULE === 'RESTRICT' || existing?.DELETE_RULE === 'NO ACTION') continue;
      const replacementName = existing?.CONSTRAINT_NAME === name ? `${name}_v2` : name;
      const escapedExisting = existing?.CONSTRAINT_NAME.replaceAll('`', '``');
      await connection.query(`ALTER TABLE user_auth_events ${existing ? `DROP FOREIGN KEY \`${escapedExisting}\`, ` : ''}ADD CONSTRAINT \`${replacementName}\` FOREIGN KEY (\`${column}\`) REFERENCES users(id) ON DELETE RESTRICT`);
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
    const [verifiedTypes] = await connection.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'user_auth_events' AND COLUMN_NAME IN ('user_id','event_type')`, [database],
    );
    const [verifiedKeys] = await connection.query(
      `SELECT r.CONSTRAINT_NAME, r.DELETE_RULE, k.COLUMN_NAME
         FROM information_schema.REFERENTIAL_CONSTRAINTS r
         JOIN information_schema.KEY_COLUMN_USAGE k ON k.CONSTRAINT_SCHEMA = r.CONSTRAINT_SCHEMA
          AND k.CONSTRAINT_NAME = r.CONSTRAINT_NAME AND k.TABLE_NAME = r.TABLE_NAME
        WHERE r.CONSTRAINT_SCHEMA = ? AND r.TABLE_NAME = 'user_auth_events' AND k.REFERENCED_TABLE_NAME = 'users'`, [database],
    );
    if (verifiedTypes.find(row => row.COLUMN_NAME === 'user_id')?.IS_NULLABLE !== 'YES'
      || verifiedTypes.find(row => row.COLUMN_NAME === 'event_type')?.COLUMN_TYPE !== eventType
      || ['user_id', 'actor_user_id'].some(column =>
        !verifiedKeys.some(row => row.COLUMN_NAME === column && ['RESTRICT', 'NO ACTION'].includes(row.DELETE_RULE)))) {
      throw new Error('Authentication activity enum, nullable account identity or retention foreign keys failed verification.');
    }
    const [existingGuards] = await connection.query(
      'SELECT TRIGGER_NAME, ACTION_STATEMENT, ACTION_TIMING, EVENT_MANIPULATION, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?',
      [database, 'user_auth_events'],
    );
    const normalize = body => body.replace(/\s+/g, ' ').trim();
    const matches = (row, guard) => row.TRIGGER_NAME === guard.name && row.ACTION_TIMING === 'BEFORE'
      && row.EVENT_MANIPULATION === guard.event && row.EVENT_OBJECT_TABLE === guard.table
      && normalize(row.ACTION_STATEMENT) === normalize(guard.body);
    for (const guard of guards) {
      const existing = existingGuards.find(row => row.TRIGGER_NAME === guard.name);
      if (existing) {
        if (!matches(existing, guard)) {
          throw new Error(`Authentication guard ${guard.name} differs; review it before changing the definition.`);
        }
      } else {
        await connection.query(`CREATE TRIGGER \`${guard.name}\` BEFORE ${guard.event} ON \`${guard.table}\` FOR EACH ROW ${guard.body}`);
      }
    }
    const [verifiedGuards] = await connection.query(
      'SELECT TRIGGER_NAME, ACTION_STATEMENT, ACTION_TIMING, EVENT_MANIPULATION, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?',
      [database, 'user_auth_events'],
    );
    if (guards.some(guard => !verifiedGuards.some(row => matches(row, guard)))) {
      throw new Error('Authentication audit write guards failed verification.');
    }
    console.log(`User authentication activity schema is ready (${requiredColumns.length} columns, ${requiredIndexes.length} indexes).`);
    console.log(`Verified ${guards.length} authentication audit write guards.`);
  }
} finally {
  await connection.end();
}