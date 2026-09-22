/**
 * Creates the shared main-database support ticket tables.
 * Run: node scripts/setup-support-tickets.mjs
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
    CREATE TABLE IF NOT EXISTS support_tickets (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      business_id VARCHAR(100) NULL,
      submitted_by_user_id INT NULL,
      submitted_by_name VARCHAR(255) NULL,
      submitted_by_email VARCHAR(255) NULL,
      source_app ENUM('ims','pos') NOT NULL,
      screen_context VARCHAR(255) NULL,
      subject VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      status ENUM('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
      assigned_to INT NULL,
      resolution_notes TEXT NULL,
      resolved_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX idx_support_ticket_status_created (status, created_at),
      INDEX idx_support_ticket_business (business_id, created_at),
      INDEX idx_support_ticket_assigned (assigned_to, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS support_ticket_settings (
      id TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
      notification_email VARCHAR(255) NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const [businessIdColumns] = await connection.query(
    `SELECT CHARACTER_SET_NAME, COLLATION_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'businesses'
        AND COLUMN_NAME = 'business_id'
      LIMIT 1`,
  );
  const businessIdColumn = businessIdColumns[0];
  if (businessIdColumn?.CHARACTER_SET_NAME && businessIdColumn?.COLLATION_NAME) {
    const [supportTicketColumns] = await connection.query(
      `SELECT CHARACTER_SET_NAME, COLLATION_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'support_tickets'
          AND COLUMN_NAME = 'business_id'
        LIMIT 1`,
    );
    const supportTicketColumn = supportTicketColumns[0];
    if (
      supportTicketColumn?.CHARACTER_SET_NAME !== businessIdColumn.CHARACTER_SET_NAME
      || supportTicketColumn?.COLLATION_NAME !== businessIdColumn.COLLATION_NAME
    ) {
      const charset = String(businessIdColumn.CHARACTER_SET_NAME).replace(/[^a-zA-Z0-9_]/g, '');
      const collation = String(businessIdColumn.COLLATION_NAME).replace(/[^a-zA-Z0-9_]/g, '');
      await connection.query(
        `ALTER TABLE support_tickets MODIFY COLUMN business_id VARCHAR(100) CHARACTER SET ${charset} COLLATE ${collation} NULL`,
      );
    }
  }
  console.log('✓ support_tickets and support_ticket_settings tables ready.');
} finally {
  await connection.end();
}
