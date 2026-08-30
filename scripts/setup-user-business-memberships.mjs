import 'dotenv/config';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
if (!apply) {
  console.log('Dry run: would create user_business_memberships, backfill existing users, and add invites.tier.');
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
  if (!businessColumn?.CHARACTER_SET_NAME || !businessColumn?.COLLATION_NAME) throw new Error('Business ID collation could not be resolved.');
  const charset = String(businessColumn.CHARACTER_SET_NAME).replace(/[^a-z0-9_]/gi, '');
  const collation = String(businessColumn.COLLATION_NAME).replace(/[^a-z0-9_]/gi, '');

  await connection.execute(`CREATE TABLE IF NOT EXISTS user_business_memberships (
    user_id             INT NOT NULL,
    business_id         VARCHAR(100) CHARACTER SET ${charset} COLLATE ${collation} NOT NULL,
    tier                ENUM('SuperAdmin','Admin','StandardUser','PosManager','PosUser','Advisor') NOT NULL DEFAULT 'StandardUser',
    is_default          TINYINT(1) NOT NULL DEFAULT 0,
    last_active_at      DATETIME(3) NULL,
    enrolled_by_user_id INT NULL,
    created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    deleted_at          DATETIME(3) NULL,
    PRIMARY KEY (user_id, business_id),
    INDEX idx_user_business_memberships_business (business_id, deleted_at, user_id),
    INDEX idx_user_business_memberships_recent (user_id, deleted_at, last_active_at),
    CONSTRAINT fk_user_business_memberships_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await connection.execute(`CREATE TABLE IF NOT EXISTS user_business_context_events (
    id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id              INT NOT NULL,
    previous_business_id VARCHAR(100) CHARACTER SET ${charset} COLLATE ${collation} NULL,
    target_business_id   VARCHAR(100) CHARACTER SET ${charset} COLLATE ${collation} NOT NULL,
    created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_user_context_actor (user_id, created_at, id),
    INDEX idx_user_context_target (target_business_id, created_at, id),
    CONSTRAINT fk_user_context_actor FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [inviteTier] = await connection.execute(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invites' AND COLUMN_NAME = 'tier' LIMIT 1`,
  );
  if (!inviteTier.length) {
    await connection.execute(`ALTER TABLE invites ADD COLUMN tier ENUM('Admin','StandardUser','PosManager','PosUser','Advisor') NULL AFTER role`);
  }

  const [backfill] = await connection.execute(
    `INSERT INTO user_business_memberships (user_id, business_id, tier, is_default)
     SELECT u.id, u.business_id, u.tier, 1
       FROM users u
       JOIN businesses b ON b.business_id = u.business_id AND b.deleted_at IS NULL
      WHERE u.business_id IS NOT NULL AND u.deleted_at IS NULL
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
  );
  await connection.execute(
    `UPDATE invites SET tier = CASE WHEN role = 'admin' THEN 'Admin' ELSE 'StandardUser' END WHERE tier IS NULL`,
  );

  const [[counts]] = await connection.execute(
    `SELECT COUNT(*) AS memberships,
            SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS active_memberships
       FROM user_business_memberships`,
  );
  console.log(JSON.stringify({ backfilledRows: backfill.affectedRows, ...counts }, null, 2));
} finally {
  await connection.end();
}