/**
 * Creates the shared main-database runtime issue registry.
 * Run: node scripts/setup-runtime-issues.mjs
 */
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
    CREATE TABLE IF NOT EXISTS runtime_issues (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      business_id VARCHAR(100) NULL,
      source VARCHAR(64) NOT NULL,
      operation VARCHAR(128) NOT NULL,
      severity ENUM('warning','error','critical') NOT NULL DEFAULT 'error',
      status ENUM('new','in_progress','fixed') NOT NULL DEFAULT 'new',
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      fingerprint CHAR(64) NOT NULL,
      first_seen_at DATETIME(3) NOT NULL,
      last_seen_at DATETIME(3) NOT NULL,
      occurrence_count INT UNSIGNED NOT NULL DEFAULT 1,
      source_reference_type VARCHAR(64) NULL,
      source_reference_id VARCHAR(191) NULL,
      latest_context JSON NULL,
      assigned_to INT NULL,
      resolution_notes TEXT NULL,
      fixed_at DATETIME(3) NULL,
      alert_pending TINYINT(1) NOT NULL DEFAULT 0,
      last_alerted_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_runtime_issue_fingerprint (fingerprint),
      INDEX idx_runtime_issue_status_seen (status, last_seen_at),
      INDEX idx_runtime_issue_business_seen (business_id, last_seen_at),
      INDEX idx_runtime_issue_source (source, operation)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS runtime_issue_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      issue_id BIGINT NOT NULL,
      event_type ENUM('occurred','status_changed','assigned','note') NOT NULL,
      severity ENUM('warning','error','critical') NULL,
      message TEXT NULL,
      stack_trace MEDIUMTEXT NULL,
      context JSON NULL,
      actor_id INT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_runtime_issue_event_issue (issue_id, created_at),
      CONSTRAINT fk_runtime_issue_events_issue
        FOREIGN KEY (issue_id) REFERENCES runtime_issues(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  for (const [columnName, definition] of [
    ['alert_pending', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER fixed_at'],
    ['last_alerted_at', 'DATETIME(3) NULL AFTER alert_pending'],
  ]) {
    const [columns] = await connection.query(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'runtime_issues' AND COLUMN_NAME = ? LIMIT 1`,
      [columnName],
    );
    if (columns.length === 0) {
      await connection.query(`ALTER TABLE runtime_issues ADD COLUMN ${columnName} ${definition}`);
    }
  }
  console.log(`Runtime issue tables are ready in ${process.env.MYSQL_DATABASE}.`);
} finally {
  await connection.end();
}