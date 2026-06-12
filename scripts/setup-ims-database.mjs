/**
 * IMS Database Setup Script
 * Run with: node scripts/setup-ims-database.mjs
 *
 * What it does:
 *  1. Connects to the MySQL server using credentials in .env.local
 *  2. Creates the IMS database (default: readyedu_MonsterthreadsIMS)
 *  3. Runs all DDL from scripts/ims-schema.sql
 *  4. Prints next steps
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const IMS_DB = process.env.IMS_MYSQL_DATABASE || 'readyedu_MonsterthreadsIMS';

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.MYSQL_HOST     || 'localhost',
    port:     parseInt(process.env.MYSQL_PORT || '3306', 10),
    user:     process.env.MYSQL_USER     || '',
    password: process.env.MYSQL_PASSWORD || '',
    database: IMS_DB,          // connect directly to the pre-created database
    multipleStatements: true,
  });

  try {
    console.log(`\n➜  Connected to "${IMS_DB}"…`);
    console.log('✓  Database ready.');

    console.log('➜  Running schema DDL…');
    const sql = readFileSync(resolve(__dirname, 'ims-schema.sql'), 'utf8');

    // Split on statement boundaries and run each one
    const statements = sql
      .split(';')
      .map(s => s.trim())
      // Strip leading comment lines, then re-trim
      .map(s => s.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n').trim())
      .filter(s => s.length > 0 && !s.toUpperCase().startsWith('SET NAMES'));

    for (const stmt of statements) {
      await conn.execute(stmt);
    }
    console.log(`✓  ${statements.length} statements executed.`);

    console.log('\n✅  IMS database setup complete!\n');
    console.log('Next steps:');
    console.log(`  1. Add this line to your .env.local:\n`);
    console.log(`     IMS_MYSQL_DATABASE=${IMS_DB}\n`);
    console.log('  2. Restart the dev server (node server.js).');
    console.log('  3. Navigate to /ims in the app.\n');
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('✗  Setup failed:', err.message);
  process.exit(1);
});
