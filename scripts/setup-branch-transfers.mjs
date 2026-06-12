import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]/,'').replace(/['"]$/,'')]; })
);

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST,
  port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: env.IMS_MYSQL_DATABASE,
});

await conn.execute(`
  CREATE TABLE IF NOT EXISTS ims_branch_transfers (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    transfer_number  VARCHAR(50)  NOT NULL UNIQUE,
    from_location_id INT          NOT NULL,
    to_location_id   INT          NOT NULL,
    status           ENUM('draft','sent','received','cancelled') NOT NULL DEFAULT 'draft',
    transfer_date    DATE         NOT NULL,
    notes            TEXT         NULL,
    received_date    DATE         NULL,
    total_value      DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`);
console.log('Created ims_branch_transfers');

await conn.execute(`
  CREATE TABLE IF NOT EXISTS ims_branch_transfer_items (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    transfer_id INT             NOT NULL,
    variant_id  VARCHAR(50)     NOT NULL,
    qty_sent    DECIMAL(10,4)   NOT NULL DEFAULT 0,
    qty_received DECIMAL(10,4)  NULL,
    unit_cost   DECIMAL(10,4)   NOT NULL DEFAULT 0,
    line_value  DECIMAL(12,2)   NOT NULL DEFAULT 0,
    notes       TEXT            NULL,
    FOREIGN KEY (transfer_id) REFERENCES ims_branch_transfers(id) ON DELETE CASCADE
  )
`);
console.log('Created ims_branch_transfer_items');

await conn.end();
console.log('Migration complete');
