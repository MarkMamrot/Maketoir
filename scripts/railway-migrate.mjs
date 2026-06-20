/**
 * railway-migrate.mjs
 *
 * Full migration from exam-ready.com.au (MariaDB) → Railway (MySQL 9.x)
 * Migrates both databases:
 *   readyedu_Solvantis       → readyedu_Solvantis  (on Railway)
 *   readyedu_MonsterthreadsIMS → readyedu_MonsterthreadsIMS (on Railway)
 *
 * Usage:  node scripts/railway-migrate.mjs
 * Options:
 *   --schema-only   Only create tables, skip data copy
 *   --data-only     Skip schema, only copy data (tables must already exist)
 *   --db=name       Only migrate one database (e.g. --db=readyedu_Solvantis)
 */

import mysql from 'mysql2/promise';
import 'dotenv/config';

// ── Config ────────────────────────────────────────────────────────────────────

const DATABASES = [
  process.env.MYSQL_DATABASE,        // readyedu_Solvantis
  process.env.IMS_MYSQL_DATABASE,    // readyedu_MonsterthreadsIMS
];

const SOURCE = {
  host:            process.env.MYSQL_HOST,
  port:            Number(process.env.MYSQL_PORT) || 3306,
  user:            process.env.MYSQL_USER,
  password:        process.env.MYSQL_PASSWORD,
  multipleStatements: true,
  connectTimeout:  30000,
};

const DEST = {
  host:            process.env.NEW_MYSQL_HOST,
  port:            Number(process.env.NEW_MYSQL_PORT),
  user:            process.env.NEW_MYSQL_USER,
  password:        process.env.NEW_MYSQL_PASSWORD,
  multipleStatements: true,
  connectTimeout:  30000,
  ssl:             { rejectUnauthorized: false },
};

const BATCH_SIZE = 500; // rows per INSERT batch

// ── CLI args ──────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const SCHEMA_ONLY = args.includes('--schema-only');
const DATA_ONLY   = args.includes('--data-only');
const DB_FILTER   = args.find(a => a.startsWith('--db='))?.split('=')[1];
const TABLE_FILTER= args.find(a => a.startsWith('--table='))?.split('=')[1];
const DBS_TO_RUN  = DB_FILTER ? [DB_FILTER] : DATABASES;

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }
function ok(msg)   { console.log(`  ✓ ${msg}`); }
function warn(msg) { console.warn(`  ⚠ ${msg}`); }
function err(msg)  { console.error(`  ✗ ${msg}`); }

/** Strip MariaDB-only DDL tokens that MySQL 9.x rejects */
function sanitiseDDL(ddl) {
  return ddl
    .replace(/\bCHECK\s*\(.*?\bCONSTRAINT_CATALOG\b.*?\)/gi, '')   // MariaDB internal
    .replace(/\bWITHOUT\s+OVERLAPS\b/gi, '')
    .replace(/\bPERIOD\s+FOR\s+\w+\s*\(.*?\)/gi, '')
    .replace(/\bPAGE_CHECKSUM\s*=\s*\d+/gi, '')
    .replace(/\bTRANSACTIONAL\s*=\s*\d+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escape a JS value for a MySQL VALUES literal */
function escape(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
  if (Buffer.isBuffer(val)) return `X'${val.toString('hex')}'`;
  const s = String(val)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x1a/g, '\\Z');
  return `'${s}'`;
}

// ── Core migration ────────────────────────────────────────────────────────────

async function migrateDatabase(dbName) {
  log(`━━━  Migrating: ${dbName}  ━━━`);

  // Open source connection for this DB
  const src = await mysql.createConnection({ ...SOURCE, database: dbName });

  // Open dest connection (no DB selected yet — we'll create it)
  const dst = await mysql.createConnection({ ...DEST });

  try {
    // 1. Create database on Railway
    await dst.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    ok(`Database '${dbName}' ready on Railway`);
    await dst.query(`USE \`${dbName}\``);

    // Disable FK checks for safe import
    await dst.query('SET FOREIGN_KEY_CHECKS = 0');
    await dst.query("SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'");

    // 2. Get table list
    const [tables] = await src.query(`SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'`);
    const tableNames = tables.map(r => Object.values(r)[0]);
    log(`Found ${tableNames.length} tables`);

    for (const table of tableNames) {
      // ── Table filter ───────────────────────────────────────────────────────
      if (TABLE_FILTER && table !== TABLE_FILTER) continue;

      // ── Schema ──────────────────────────────────────────────────────────
      if (!DATA_ONLY) {
        try {
          const [[createRow]] = await src.query(`SHOW CREATE TABLE \`${table}\``);
          let ddl = createRow['Create Table'];
          ddl = sanitiseDDL(ddl);

          await dst.query(`DROP TABLE IF EXISTS \`${table}\``);
          await dst.query(ddl);
          ok(`Schema: ${table}`);
        } catch (e) {
          err(`Schema FAILED for ${table}: ${e.message}`);
          continue;
        }
      }

      // ── Data ─────────────────────────────────────────────────────────────
      if (!SCHEMA_ONLY) {
        try {
          const [[{ cnt }]] = await src.query(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
          const total = Number(cnt);

          if (total === 0) {
            ok(`Data:   ${table} — 0 rows (skipped)`);
            continue;
          }

          await dst.query(`DELETE FROM \`${table}\``);

          // Get column list
          const [cols] = await src.query(`SHOW COLUMNS FROM \`${table}\``);
          const colNames = cols.map(c => `\`${c.Field}\``).join(', ');

          // Detect single-column integer primary key for cursor-based pagination
          const pkCol = cols.find(c => c.Key === 'PRI' && /int/i.test(c.Type) &&
                                       !cols.some(x => x.Key === 'PRI' && x.Field !== c.Field));

          let inserted = 0;

          if (pkCol) {
            // Cursor-based: avoids temp-table disk pressure on source
            let lastId = -1;
            while (true) {
              const [rows] = await src.query(
                `SELECT * FROM \`${table}\` WHERE \`${pkCol.Field}\` > ${lastId} ORDER BY \`${pkCol.Field}\` LIMIT ${BATCH_SIZE}`
              );
              if (rows.length === 0) break;

              const values = rows.map(
                row => `(${Object.values(row).map(escape).join(', ')})`
              ).join(',\n  ');

              await dst.query(
                `INSERT INTO \`${table}\` (${colNames}) VALUES\n  ${values}`
              );

              lastId    = rows[rows.length - 1][pkCol.Field];
              inserted += rows.length;
            }
          } else {
            // Fallback: LIMIT/OFFSET (for tables without integer PK)
            let offset = 0;
            while (offset < total) {
              const [rows] = await src.query(
                `SELECT * FROM \`${table}\` LIMIT ${BATCH_SIZE} OFFSET ${offset}`
              );
              if (rows.length === 0) break;

              const values = rows.map(
                row => `(${Object.values(row).map(escape).join(', ')})`
              ).join(',\n  ');

              await dst.query(
                `INSERT INTO \`${table}\` (${colNames}) VALUES\n  ${values}`
              );

              inserted += rows.length;
              offset   += rows.length;
            }
          }

          ok(`Data:   ${table} — ${inserted.toLocaleString()} / ${total.toLocaleString()} rows`);
        } catch (e) {
          err(`Data FAILED for ${table}: ${e.message}`);
        }
      }
    }

    // Re-enable FK checks
    await dst.query('SET FOREIGN_KEY_CHECKS = 1');
    log(`✅  ${dbName} migration complete\n`);

  } finally {
    await src.end();
    await dst.end();
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

(async () => {
  log('Railway Migration Starting');
  log(`Source: ${SOURCE.host}`);
  log(`Dest:   ${DEST.host}:${DEST.port}`);
  log(`Mode:   ${SCHEMA_ONLY ? 'schema-only' : DATA_ONLY ? 'data-only' : 'full'}`);
  log(`DBs:    ${DBS_TO_RUN.join(', ')}\n`);

  const start = Date.now();

  for (const db of DBS_TO_RUN) {
    try {
      await migrateDatabase(db);
    } catch (e) {
      err(`Fatal error migrating ${db}: ${e.message}`);
      process.exit(1);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(`🎉  All done in ${elapsed}s`);
})();
