/**
 * Migration: add gift_card_transactions and store_credit_transactions tables
 * to all IMS tenant schemas. Safe to re-run (skips if already exists).
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT) || 3306,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  multipleStatements: true,
});

async function migrateSchema(schema) {
  const [tables] = await conn.query(`SHOW TABLES FROM \`${schema}\``);
  const tableNames = tables.map(t => Object.values(t)[0]);

  if (!tableNames.includes('gift_card_transactions')) {
    await conn.query(`
      CREATE TABLE \`${schema}\`.gift_card_transactions (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        card_id       INT NOT NULL,
        type          ENUM('issue','redeem','return','adjust') NOT NULL,
        amount        DECIMAL(12,2) NOT NULL,
        balance_after DECIMAL(12,2) NOT NULL,
        pos_sale_id   INT NULL,
        notes         VARCHAR(255) NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_gct_card (card_id),
        INDEX idx_gct_sale (pos_sale_id),
        CONSTRAINT fk_gct_card FOREIGN KEY (card_id)
          REFERENCES \`${schema}\`.gift_cards(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`✓ ${schema}: created gift_card_transactions`);
  } else {
    console.log(`  ${schema}: gift_card_transactions already exists — skipped`);
  }

  if (!tableNames.includes('store_credit_transactions')) {
    await conn.query(`
      CREATE TABLE \`${schema}\`.store_credit_transactions (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        contact_id    INT NOT NULL,
        type          ENUM('issue','redeem','adjust') NOT NULL,
        amount        DECIMAL(12,2) NOT NULL,
        balance_after DECIMAL(12,2) NOT NULL,
        pos_sale_id   INT NULL,
        notes         VARCHAR(255) NULL,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sct_contact (contact_id),
        INDEX idx_sct_sale    (pos_sale_id),
        CONSTRAINT fk_sct_contact FOREIGN KEY (contact_id)
          REFERENCES \`${schema}\`.ims_contacts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`✓ ${schema}: created store_credit_transactions`);
  } else {
    console.log(`  ${schema}: store_credit_transactions already exists — skipped`);
  }
}

try {
  const schemas = new Set();
  const mainDb = process.env.MYSQL_DATABASE;
  if (mainDb) {
    const [rows] = await conn.query(
      `SELECT ims_db_name FROM \`${mainDb}\`.businesses WHERE ims_db_name IS NOT NULL AND deleted_at IS NULL`,
    );
    for (const r of rows) if (r.ims_db_name) schemas.add(r.ims_db_name);
  }
  if (!schemas.size) {
    console.error('No IMS schemas found. Check MYSQL_DATABASE env var.');
    process.exit(1);
  }
  console.log(`Schemas to migrate: ${[...schemas].join(', ')}`);
  for (const schema of schemas) await migrateSchema(schema);
  console.log('\nDone.');
} finally {
  await conn.end();
}
