/**
 * Creates the ims_credit_notes and ims_credit_note_items tables.
 * Run: node scripts/setup-credit-notes.mjs
 */

import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT || 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

await conn.execute(`
  CREATE TABLE IF NOT EXISTS ims_credit_notes (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    business_id         VARCHAR(150) NOT NULL,
    cn_number           VARCHAR(30)  NOT NULL,
    customer_id         INT          NULL,
    location_id         INT          NOT NULL,
    status              ENUM('draft','complete') NOT NULL DEFAULT 'draft',
    cn_date             DATE         NOT NULL,
    completed_at        DATETIME     NULL,
    reference           VARCHAR(255) NULL COMMENT 'e.g. original SO or invoice number',
    tax_treatment       ENUM('ex_tax','inc_tax') NOT NULL DEFAULT 'ex_tax',
    tax_code            VARCHAR(50)  NULL,
    subtotal            DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
    notes               TEXT         NULL,
    xero_credit_note_id VARCHAR(100) NULL,
    xero_synced_at      DATETIME     NULL,
    xero_sync_status    ENUM('synced','queued','error') NULL,
    created_by          VARCHAR(150) NULL,
    created_at          DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_business (business_id),
    INDEX idx_status   (status),
    INDEX idx_customer (customer_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
console.log('✅ ims_credit_notes table created (or already exists).');

await conn.execute(`
  CREATE TABLE IF NOT EXISTS ims_credit_note_items (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    cn_id        INT           NOT NULL,
    variant_id   VARCHAR(100)  NULL,
    code         VARCHAR(100)  NULL,
    name         VARCHAR(255)  NULL,
    qty          DECIMAL(10,4) NOT NULL DEFAULT 1,
    unit_price   DECIMAL(12,4) NOT NULL DEFAULT 0,
    price_basis  ENUM('cost','wholesale','rrp','custom') NOT NULL DEFAULT 'custom',
    tax_rate     DECIMAL(6,4)  NOT NULL DEFAULT 0,
    line_total   DECIMAL(12,4) NOT NULL DEFAULT 0,
    INDEX idx_cn (cn_id),
    FOREIGN KEY (cn_id) REFERENCES ims_credit_notes(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
console.log('✅ ims_credit_note_items table created (or already exists).');

await conn.end();
