/**
 * Convert all IMS DB tables to utf8mb4_general_ci (the schema baseline).
 * Fixes "Illegal mix of collations" errors on cross-table JOINs.
 * Run: node scripts/fix-all-collations.mjs
 */
import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const c = await createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT||3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.IMS_MYSQL_DATABASE });

const [tables] = await c.execute(
  `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = ? AND TABLE_COLLATION <> 'utf8mb4_general_ci' AND TABLE_TYPE = 'BASE TABLE'
   ORDER BY TABLE_NAME`,
  [process.env.IMS_MYSQL_DATABASE]
);

if (!tables.length) { console.log('✅ All tables already utf8mb4_general_ci'); await c.end(); process.exit(0); }

console.log(`Converting ${tables.length} table(s)…`);
for (const t of tables) {
  try {
    await c.execute(`ALTER TABLE \`${t.TABLE_NAME}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
    console.log(`  ✔ ${t.TABLE_NAME}`);
  } catch (e) {
    console.error(`  ✘ ${t.TABLE_NAME}:`, e.message);
  }
}

const [remaining] = await c.execute(
  `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_COLLATION<>'utf8mb4_general_ci' AND TABLE_TYPE='BASE TABLE'`,
  [process.env.IMS_MYSQL_DATABASE]
);
console.log(`\nRemaining mismatched tables: ${remaining[0].n}`);
await c.end();
console.log('✅ Done.');
