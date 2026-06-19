#!/usr/bin/env node

/**
 * Migrate user table to add tier/role-based access control
 * Run: node scripts/migrate-user-tiers.mjs
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const config = {
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
};

async function migrate() {
  let conn;
  try {
    conn = await mysql.createConnection(config);
    console.log('Connected to MySQL.');

    // Check if tier column already exists
    const [columns] = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'tier'
    `);

    if (columns.length > 0) {
      console.log('✓ tier column already exists.');
      await conn.end();
      return;
    }

    // Add tier column with ENUM type
    console.log('Adding tier column to users table...');
    await conn.query(`
      ALTER TABLE users 
      ADD COLUMN tier ENUM('SuperAdmin', 'Admin', 'StandardUser', 'PosUser') 
      DEFAULT 'StandardUser' NOT NULL 
      AFTER role
    `);
    console.log('✓ tier column added.');

    // Set first user as SuperAdmin (assuming they're the original admin)
    console.log('Setting first admin user as SuperAdmin...');
    await conn.query(`
      UPDATE users 
      SET tier = 'SuperAdmin' 
      WHERE role = 'admin' AND tier = 'StandardUser'
      LIMIT 1
    `);
    console.log('✓ First admin user set to SuperAdmin.');

    // Set remaining admin users as Admin
    console.log('Setting remaining admin users as Admin...');
    await conn.query(`
      UPDATE users 
      SET tier = 'Admin' 
      WHERE role = 'admin' AND tier = 'StandardUser'
    `);
    console.log('✓ Remaining admin users set to Admin.');

    // POS users remain as PosUser tier (or StandardUser if they haven't been categorized)
    console.log('✓ Migration complete!');
    console.log('\nUser tier assignments:');
    const [users] = await conn.query('SELECT id, email, role, tier FROM users WHERE deleted_at IS NULL');
    console.table(users);

    await conn.end();
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();
