/**
 * railway-verify.mjs
 *
 * Compares row counts between source (exam-ready.com.au) and destination (Railway)
 * for both databases. Run after migration to confirm everything copied correctly.
 *
 * Usage:  node scripts/railway-verify.mjs
 */

import mysql from 'mysql2/promise';
import 'dotenv/config';

const DATABASES = [
  process.env.MYSQL_DATABASE,
  process.env.IMS_MYSQL_DATABASE,
];

const SOURCE = {
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  connectTimeout: 15000,
};
const DEST = {
  host: process.env.NEW_MYSQL_HOST, port: Number(process.env.NEW_MYSQL_PORT),
  user: process.env.NEW_MYSQL_USER, password: process.env.NEW_MYSQL_PASSWORD,
  connectTimeout: 15000, ssl: { rejectUnauthorized: false },
};

async function verifyDatabase(dbName) {
  console.log(`\n━━━  ${dbName}  ━━━`);

  const src = await mysql.createConnection({ ...SOURCE, database: dbName });
  const dst = await mysql.createConnection({ ...DEST, database: dbName });

  try {
    const [tables] = await src.execute(`SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'`);
    const tableNames = tables.map(r => Object.values(r)[0]);

    let allMatch = true;
    const rows = [];

    for (const table of tableNames) {
      const [[{ src_cnt }]] = await src.execute(`SELECT COUNT(*) AS src_cnt FROM \`${table}\``);
      let dst_cnt = '—';
      let match = false;
      try {
        const [[r]] = await dst.execute(`SELECT COUNT(*) AS dst_cnt FROM \`${table}\``);
        dst_cnt = r.dst_cnt;
        match = Number(src_cnt) === Number(dst_cnt);
      } catch {
        dst_cnt = 'MISSING';
      }
      if (!match) allMatch = false;
      rows.push({ table, source: Number(src_cnt), railway: dst_cnt, match: match ? '✓' : '✗ MISMATCH' });
    }

    console.table(rows);
    console.log(allMatch ? `  ✅ All tables match!` : `  ❌ Some tables have mismatches — re-run migration for those.`);
  } finally {
    await src.end();
    await dst.end();
  }
}

(async () => {
  for (const db of DATABASES) {
    await verifyDatabase(db).catch(e => console.error(`  Error: ${e.message}`));
  }
})();
