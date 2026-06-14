// scripts/migrate-roles-invites.mjs
// Run once to add `role` column to users and create the invites table.
// Usage: node scripts/migrate-roles-invites.mjs

import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST     ?? 'localhost',
  port:     parseInt(process.env.MYSQL_PORT ?? '3306', 10),
  database: process.env.MYSQL_DATABASE ?? '',
  user:     process.env.MYSQL_USER     ?? '',
  password: process.env.MYSQL_PASSWORD ?? '',
});

console.log('Connected. Running migrations...');

// 1. Add role column to users (idempotent — fails silently if already exists)
try {
  await conn.execute(`
    ALTER TABLE users
    ADD COLUMN role ENUM('admin','user') NOT NULL DEFAULT 'admin'
    AFTER business_id
  `);
  console.log('✓ Added role column to users');
} catch (e) {
  if (e.code === 'ER_DUP_FIELDNAME') {
    console.log('— role column already exists, skipping');
  } else {
    throw e;
  }
}

// 2. Create invites table
await conn.execute(`
  CREATE TABLE IF NOT EXISTS invites (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    token       VARCHAR(64) NOT NULL UNIQUE,
    email       VARCHAR(255) NOT NULL,
    business_id VARCHAR(100) NOT NULL,
    invited_by  INT NOT NULL,
    role        ENUM('admin','user') NOT NULL DEFAULT 'user',
    expires_at  DATETIME NOT NULL,
    accepted_at DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
console.log('✓ invites table ready');

await conn.end();
console.log('Done.');
