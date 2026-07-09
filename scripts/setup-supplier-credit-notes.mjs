/**
 * Supplier Credit Notes (credits RECEIVED FROM suppliers → Xero ACCPAY credit notes).
 * Creates ims_supplier_credit_notes + ims_supplier_credit_note_items and extends the
 * stock-movement enums for supplier returns.
 * Run: node scripts/setup-supplier-credit-notes.mjs
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
  CREATE TABLE IF NOT EXISTS ims_supplier_credit_notes (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    business_id         VARCHAR(150) NOT NULL,
    scn_number          VARCHAR(30)  NOT NULL,
    supplier_id         INT          NULL,
    po_id               INT          NULL,
    location_id         INT          NOT NULL,
    status              ENUM('draft','complete','cancelled') NOT NULL DEFAULT 'draft',
    scn_date            DATE         NOT NULL,
    completed_at        DATETIME     NULL,
    reference           VARCHAR(255) NULL COMMENT 'e.g. original PO / bill number',
    supplier_credit_ref VARCHAR(100) NULL COMMENT 'the supplier''s own credit note number',
    currency_code       VARCHAR(3)   NOT NULL DEFAULT 'AUD',
    exchange_rate       DECIMAL(14,6) NOT NULL DEFAULT 1,
    tax_treatment       ENUM('ex_tax','inc_tax','no_tax') NOT NULL DEFAULT 'ex_tax',
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
    UNIQUE KEY uq_business_scn (business_id, scn_number),
    INDEX idx_business (business_id),
    INDEX idx_status   (status),
    INDEX idx_supplier (supplier_id),
    INDEX idx_po       (po_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
console.log('✅ ims_supplier_credit_notes ready.');

await conn.execute(`
  CREATE TABLE IF NOT EXISTS ims_supplier_credit_note_items (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    scn_id       INT           NOT NULL,
    variant_id   VARCHAR(100)  NULL,
    code         VARCHAR(100)  NULL,
    name         VARCHAR(255)  NULL,
    qty          DECIMAL(10,4) NOT NULL DEFAULT 1,
    unit_cost    DECIMAL(12,4) NOT NULL DEFAULT 0,
    restock      TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '1 = goods physically returned to supplier (reduces stock)',
    tax_rate     DECIMAL(6,4)  NOT NULL DEFAULT 0,
    line_total   DECIMAL(12,4) NOT NULL DEFAULT 0,
    INDEX idx_scn (scn_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
console.log('✅ ims_supplier_credit_note_items ready.');

// Extend movement_type enum with scn_returned (stock leaving to a supplier).
const [mv] = await conn.query(`SHOW COLUMNS FROM ims_stock_movements LIKE 'movement_type'`);
if (mv[0] && !/scn_returned/.test(mv[0].Type)) {
  // Preserve existing values, append scn_returned.
  const values = mv[0].Type.replace(/^enum\(/i, '').replace(/\)$/, '');
  await conn.query(
    `ALTER TABLE ims_stock_movements MODIFY COLUMN movement_type ENUM(${values}, 'scn_returned') NOT NULL`,
  );
  console.log('✅ movement_type: added scn_returned');
} else {
  console.log('• movement_type already has scn_returned');
}

// Extend reference_type enum with supplier_credit_note.
const [rt] = await conn.query(`SHOW COLUMNS FROM ims_stock_movements LIKE 'reference_type'`);
if (rt[0] && !/supplier_credit_note/.test(rt[0].Type)) {
  const values = rt[0].Type.replace(/^enum\(/i, '').replace(/\)$/, '');
  await conn.query(
    `ALTER TABLE ims_stock_movements MODIFY COLUMN reference_type ENUM(${values}, 'supplier_credit_note') NOT NULL`,
  );
  console.log('✅ reference_type: added supplier_credit_note');
} else {
  console.log('• reference_type already has supplier_credit_note');
}

await conn.end();
console.log('\n✅ Supplier credit notes schema ready.');
