import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  multipleStatements: true,
});

try {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS bookkeeper_audit_reviews (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      business_id VARCHAR(255) NOT NULL,
      finding_key VARCHAR(191) NOT NULL,
      fingerprint CHAR(64) NOT NULL,
      status ENUM('accepted','revoked') NOT NULL DEFAULT 'accepted',
      reason VARCHAR(1000) NOT NULL,
      actor_id VARCHAR(100) NULL,
      actor_name VARCHAR(255) NULL,
      accepted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      revoked_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_bookkeeper_audit_review (business_id, finding_key, fingerprint),
      INDEX idx_bookkeeper_audit_review_queue (business_id, status, accepted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS bookkeeper_audit_review_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      business_id VARCHAR(255) NOT NULL,
      review_id BIGINT NOT NULL,
      event_type ENUM('accepted','revoked') NOT NULL,
      actor_id VARCHAR(100) NULL,
      actor_name VARCHAR(255) NULL,
      reason VARCHAR(1000) NULL,
      fingerprint CHAR(64) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_bookkeeper_audit_review_event (business_id, review_id, created_at),
      CONSTRAINT fk_bookkeeper_audit_review_event_review FOREIGN KEY (review_id)
        REFERENCES bookkeeper_audit_reviews(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const expectedTables = ['bookkeeper_audit_reviews', 'bookkeeper_audit_review_events'];
  const [rows] = await connection.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)`,
    expectedTables,
  );
  const existing = new Set(rows.map(row => row.TABLE_NAME));
  const missing = expectedTables.filter(table => !existing.has(table));
  if (missing.length > 0) throw new Error(`Bookkeeper audit schema verification failed; missing: ${missing.join(', ')}`);
  console.log(`Bookkeeper audit tables are ready in ${process.env.MYSQL_DATABASE}.`);
} finally {
  await connection.end();
}