#!/usr/bin/env node
/**
 * Adds 'PosManager' to the users.tier ENUM.
 * Run: node scripts/add-pos-manager-tier.mjs
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { existsSync } from 'fs';

// Try .env.local first, then .env
if (existsSync('.env.local')) { dotenv.config({ path: '.env.local' }); }
else { dotenv.config(); }

const config = {
  host:     process.env.MYSQL_HOST,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port:     parseInt(process.env.MYSQL_PORT || '3306'),
};

async function migrate() {
  let conn;
  try {
    conn = await mysql.createConnection(config);
    console.log('Connected to MySQL.');

    // Check current ENUM definition
    const [cols] = await conn.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'tier'`,
      [config.database],
    );

    if (!cols.length) {
      console.error('✗ tier column not found in users table.');
      return;
    }

    const currentType = cols[0].COLUMN_TYPE;
    console.log('Current tier column type:', currentType);

    if (currentType.includes('PosManager')) {
      console.log('✓ PosManager already in ENUM — nothing to do.');
      return;
    }

    // Extend ENUM to include PosManager between StandardUser and PosUser
    console.log("Adding 'PosManager' to tier ENUM...");
    await conn.query(`
      ALTER TABLE users
      MODIFY COLUMN tier ENUM('SuperAdmin', 'Admin', 'StandardUser', 'PosManager', 'PosUser')
      NOT NULL DEFAULT 'StandardUser'
    `);

    const [updated] = await conn.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'tier'`,
      [config.database],
    );
    console.log('✓ Migration complete. New type:', updated[0]?.COLUMN_TYPE);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

migrate();
