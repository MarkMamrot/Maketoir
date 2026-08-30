import 'dotenv/config';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');

if (!apply) {
  console.log('Dry run: would create and verify super_admin_business_context_events.');
  console.log('Re-run with --apply to execute.');
  process.exit(0);
}

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

try {
  const [businessColumns] = await connection.execute(
    `SELECT CHARACTER_SET_NAME, COLLATION_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'businesses'
        AND COLUMN_NAME = 'business_id'
      LIMIT 1`,
  );
  const businessColumn = businessColumns[0];
  if (!businessColumn?.CHARACTER_SET_NAME || !businessColumn?.COLLATION_NAME) {
    throw new Error('businesses.business_id collation could not be resolved.');
  }
  const charset = String(businessColumn.CHARACTER_SET_NAME).replace(/[^a-z0-9_]/gi, '');
  const collation = String(businessColumn.COLLATION_NAME).replace(/[^a-z0-9_]/gi, '');

  await connection.execute(`CREATE TABLE IF NOT EXISTS super_admin_business_context_events (
    id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor_user_id        INT NOT NULL,
    previous_business_id VARCHAR(100) CHARACTER SET ${charset} COLLATE ${collation} NULL,
    target_business_id   VARCHAR(100) CHARACTER SET ${charset} COLLATE ${collation} NOT NULL,
    created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_super_admin_context_actor (actor_user_id, created_at, id),
    INDEX idx_super_admin_context_target (target_business_id, created_at, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'super_admin_business_context_events'`,
  );
  const [indexes] = await connection.execute(
    `SELECT DISTINCT INDEX_NAME
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'super_admin_business_context_events'`,
  );
  const columnNames = new Set(columns.map(row => row.COLUMN_NAME));
  const indexNames = new Set(indexes.map(row => row.INDEX_NAME));
  for (const name of ['id', 'actor_user_id', 'previous_business_id', 'target_business_id', 'created_at']) {
    if (!columnNames.has(name)) throw new Error(`Missing column ${name}.`);
  }
  for (const name of ['idx_super_admin_context_actor', 'idx_super_admin_context_target']) {
    if (!indexNames.has(name)) throw new Error(`Missing index ${name}.`);
  }
  console.log(JSON.stringify({ table: 'super_admin_business_context_events', columns: columnNames.size, indexes: [...indexNames] }, null, 2));
} finally {
  await connection.end();
}