/**
 * Migration: create business_applications + business_application_events tables.
 * Run with: node scripts/add-business-applications.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

async function tableExists(name) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name],
  );
  return rows[0].cnt > 0;
}

if (await tableExists('business_applications')) {
  console.log('  – Already exists: business_applications');
} else {
  await conn.execute(`
    CREATE TABLE business_applications (
      id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
      flow_type            ENUM('new_user','existing_user') NOT NULL,
      applicant_user_id    INT NOT NULL,
      contact_name         VARCHAR(255) NULL,
      contact_email        VARCHAR(320) NULL,
      contact_phone        VARCHAR(50) NULL,
      business_name        VARCHAR(255) NOT NULL,
      business_type        VARCHAR(32) NULL,
      location_count_band  VARCHAR(16) NULL,
      channels             VARCHAR(255) NULL,
      revenue_band         VARCHAR(32) NULL,
      country              VARCHAR(100) NULL,
      abn                  VARCHAR(32) NULL,
      notes                VARCHAR(2000) NULL,
      status               ENUM('pending_review','approved','rejected') NOT NULL DEFAULT 'pending_review',
      reviewed_by_user_id  INT NULL,
      reviewed_by_name     VARCHAR(255) NULL,
      reviewed_at          DATETIME(3) NULL,
      review_reason        VARCHAR(1000) NULL,
      resulting_business_id VARCHAR(100) NULL,
      created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX idx_business_applications_queue (status, created_at),
      INDEX idx_business_applications_applicant (applicant_user_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ Created table: business_applications');
}

if (await tableExists('business_application_events')) {
  console.log('  – Already exists: business_application_events');
} else {
  await conn.execute(`
    CREATE TABLE business_application_events (
      id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
      application_id     BIGINT NOT NULL,
      event_type         ENUM('submitted','approved','rejected') NOT NULL,
      actor_user_id      INT NULL,
      actor_name         VARCHAR(255) NULL,
      reason             VARCHAR(1000) NULL,
      created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_business_application_events_application (application_id, created_at),
      CONSTRAINT fk_business_application_events_application
        FOREIGN KEY (application_id) REFERENCES business_applications(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ Created table: business_application_events');
}

await conn.end();
console.log('Done.');
