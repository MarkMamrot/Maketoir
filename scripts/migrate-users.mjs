#!/usr/bin/env node
/**
 * migrate-users.mjs
 * Reads the master Users Google Sheet and inserts all users into MySQL.
 * Passwords are bcrypt-hashed during migration.
 *
 * Usage: node scripts/migrate-users.mjs
 * Requires: MASTER_USERS_SHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY in .env
 */
import 'dotenv/config';
import { google } from 'googleapis';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     parseInt(process.env.MYSQL_PORT ?? '3306', 10),
  database: process.env.MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});

const masterSheetId = process.env.MASTER_USERS_SHEET_ID;
if (!masterSheetId) {
  console.error('MASTER_USERS_SHEET_ID is not set in .env');
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  credentials: process.env.GOOGLE_CLIENT_EMAIL ? {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key:  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  } : undefined,
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});
const sheets = google.sheets({ version: 'v4', auth });

const { data } = await sheets.spreadsheets.values.get({
  spreadsheetId: masterSheetId,
  range: 'Users!A:G',
});

const rows = data.values ?? [];
if (rows.length < 2) {
  console.log('No user rows found.');
  await conn.end();
  process.exit(0);
}

// Headers: Name, Company, Email, Phone, Password, UserSpreadsheetId, RegistrationDate
let inserted = 0, skipped = 0;
for (const row of rows.slice(1)) {
  const [name, company, email, phone, plainPwd, spreadsheetId, regDate] = row;
  if (!email) continue;

  // Check for existing
  const [existing] = await conn.execute('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (existing.length > 0) { skipped++; continue; }

  const hash = await bcrypt.hash(plainPwd || '', 12);
  await conn.execute(
    `INSERT INTO users (name, company, email, phone, password_hash, business_id, registered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name || null, company || null, email.toLowerCase(), phone || null,
     hash, spreadsheetId || null,
     regDate ? new Date(regDate) : null],
  );

  // Also ensure business row exists
  if (spreadsheetId) {
    await conn.execute(
      `INSERT INTO businesses (business_id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [spreadsheetId, company || name || 'Unknown'],
    );
  }
  inserted++;
  console.log(`  ✓ ${email} → business_id: ${spreadsheetId}`);
}

console.log(`\nDone. Inserted: ${inserted}, Skipped (already exists): ${skipped}`);
await conn.end();
