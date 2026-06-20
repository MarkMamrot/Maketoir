/**
 * railway-migrate-tables.mjs
 * Migrate specific tables from source → Railway.
 * Usage: node scripts/railway-migrate-tables.mjs <db> <table1> [table2 ...]
 * Example: node scripts/railway-migrate-tables.mjs readyedu_MonsterthreadsIMS pos_sales pos_users
 */

import mysql from 'mysql2/promise';
import 'dotenv/config';

const [, , dbName, ...tables] = process.argv;
if (!dbName || tables.length === 0) {
  console.error('Usage: node railway-migrate-tables.mjs <db> <table1> [table2 ...]');
  process.exit(1);
}

const SOURCE = {
  host:           process.env.MYSQL_HOST,
  port:           Number(process.env.MYSQL_PORT) || 3306,
  user:           process.env.MYSQL_USER,
  password:       process.env.MYSQL_PASSWORD,
  connectTimeout: 30000,
};

const DEST = {
  host:           process.env.NEW_MYSQL_HOST,
  port:           Number(process.env.NEW_MYSQL_PORT),
  user:           process.env.NEW_MYSQL_USER,
  password:       process.env.NEW_MYSQL_PASSWORD,
  ssl:            { rejectUnauthorized: false },
  connectTimeout: 30000,
};

const BATCH_SIZE = 200;

function sanitiseDDL(ddl) {
  return ddl
    .replace(/ENGINE=Aria[^,\n]*/gi, 'ENGINE=InnoDB')
    .replace(/\bROW_FORMAT=PAGE\b/gi, '')
    .replace(/\bPAGE_CHECKSUM=\d\b/gi, '')
    .replace(/\bTRANSACTIONAL=\d\b/gi, '')
    .replace(/,\s*\)/g, '\n)')
    .replace(/ENGINE=InnoDB\s+DEFAULT CHARSET=([^\s]+)\s+COLLATE=([^\s;]+)/i,
      'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
}

function escapeValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
  if (typeof v === 'number') return String(v);
  if (Buffer.isBuffer(v)) return `0x${v.toString('hex')}`;
  const s = String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  return `'${s}'`;
}

const src = await mysql.createConnection({ ...SOURCE, database: dbName });
const dst = await mysql.createConnection({ ...DEST });

await dst.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await dst.query(`USE \`${dbName}\``);
await dst.query('SET FOREIGN_KEY_CHECKS = 0');
await dst.query("SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'");

for (const table of tables) {
  console.log(`\n── ${table} ──`);

  // Schema
  try {
    const [[row]] = await src.query(`SHOW CREATE TABLE \`${table}\``);
    let ddl = row['Create Table'];
    ddl = sanitiseDDL(ddl);
    await dst.query(`DROP TABLE IF EXISTS \`${table}\``);
    await dst.query(ddl);
    console.log(`  ✓ Schema created`);
  } catch (e) {
    console.error(`  ✗ Schema FAILED: ${e.message}`);
    continue;
  }

  // Count
  const [[{ cnt }]] = await src.query(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
  const total = Number(cnt);
  if (total === 0) { console.log(`  ✓ No rows`); continue; }

  // Columns
  const [cols] = await src.query(`SHOW COLUMNS FROM \`${table}\``);
  const colNames = cols.map(c => `\`${c.Field}\``).join(', ');

  let inserted = 0;
  for (let offset = 0; offset < total; offset += BATCH_SIZE) {
    const [rows] = await src.query(`SELECT * FROM \`${table}\` LIMIT ${BATCH_SIZE} OFFSET ${offset}`);
    if (!rows.length) break;

    const values = rows.map(r =>
      '(' + cols.map(c => escapeValue(r[c.Field])).join(', ') + ')'
    ).join(',\n  ');

    try {
      await dst.query(`INSERT INTO \`${table}\` (${colNames}) VALUES\n  ${values}`);
      inserted += rows.length;
      process.stdout.write(`\r  ✓ Data: ${inserted.toLocaleString()} / ${total.toLocaleString()} rows`);
    } catch (e) {
      console.error(`\n  ✗ Insert FAILED at offset ${offset}: ${e.message}`);
      break;
    }
  }
  console.log(`\n  Done`);
}

await dst.query('SET FOREIGN_KEY_CHECKS = 1');
await src.end();
await dst.end();
console.log('\n✅ Done');
