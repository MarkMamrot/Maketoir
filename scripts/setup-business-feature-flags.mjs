import 'dotenv/config';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const monsterthreadsBusinessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const featureKey = 'foresight.marketing';

if (!apply) {
  console.log(`Dry run: would create business_feature_flags and seed ${featureKey} for Monsterthreads only.`);
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
    `SELECT CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses' AND COLUMN_NAME = 'business_id' LIMIT 1`,
  );
  const businessColumn = businessColumns[0];
  if (!businessColumn?.CHARACTER_SET_NAME || !businessColumn?.COLLATION_NAME) throw new Error('businesses.business_id collation could not be resolved.');
  const charset = String(businessColumn.CHARACTER_SET_NAME).replace(/[^a-z0-9_]/gi, '');
  const collation = String(businessColumn.COLLATION_NAME).replace(/[^a-z0-9_]/gi, '');
  await connection.execute(`CREATE TABLE IF NOT EXISTS business_feature_flags (
    business_id       VARCHAR(100) CHARACTER SET ${charset} COLLATE ${collation} NOT NULL,
    feature_key       VARCHAR(100) NOT NULL,
    enabled           TINYINT(1) NOT NULL DEFAULT 0,
    changed_by_user_id INT NULL,
    changed_by_name   VARCHAR(255) NULL,
    changed_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (business_id, feature_key),
    INDEX idx_business_feature_enabled (feature_key, enabled, business_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await connection.execute(
    `ALTER TABLE business_feature_flags MODIFY business_id VARCHAR(100) CHARACTER SET ${charset} COLLATE ${collation} NOT NULL`,
  );
  await connection.execute(
    `INSERT INTO business_feature_flags (business_id, feature_key, enabled, changed_by_name)
     SELECT business_id, ?, IF(business_id = ?, 1, 0), 'Initial Marketing rollout'
     FROM businesses WHERE deleted_at IS NULL
     ON DUPLICATE KEY UPDATE business_id = VALUES(business_id)`,
    [featureKey, monsterthreadsBusinessId],
  );
  const [rows] = await connection.execute(
    `SELECT b.name, f.enabled FROM businesses b
     JOIN business_feature_flags f ON f.business_id = b.business_id AND f.feature_key = ?
     WHERE b.deleted_at IS NULL ORDER BY b.name`,
    [featureKey],
  );
  const enabled = rows.filter(row => Boolean(row.enabled));
  if (enabled.length !== 1 || enabled[0].name.toLowerCase() !== 'monsterthreads') {
    throw new Error(`Expected Marketing enabled only for Monsterthreads; found ${enabled.map(row => row.name).join(', ') || 'none'}.`);
  }
  console.log(JSON.stringify({ featureKey, businesses: rows, verifiedEnabledOnly: enabled[0].name }, null, 2));
} finally {
  await connection.end();
}
