/**
 * Provision IMS for a business: create its schema on the shared MySQL server,
 * load the IMS schema DDL, install the business_id triggers, and record
 * businesses.ims_db_name. Mirrors src/lib/ims/provisionBusiness.ts for CLI use.
 *
 * Usage:
 *   node scripts/provision-business.mjs --business-id=<id> --name="Acme Co"
 *   node scripts/provision-business.mjs --business-id=<id> --db-name=readyedu_AcmeIMS
 *   add --apply to actually create (default is a dry run that prints the plan)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));
const APPLY = !!args.apply;

const businessId = args['business-id'];
const name = args['name'];
let dbName = args['db-name'];
if (!businessId) { console.error('Missing --business-id'); process.exit(1); }
if (!dbName) {
  if (!name) { console.error('Provide --name or --db-name'); process.exit(1); }
  const prefix = process.env.IMS_DB_PREFIX ?? 'readyedu_';
  dbName = `${prefix}${String(name).replace(/[^a-zA-Z0-9]/g, '')}IMS`;
}
dbName = String(dbName).replace(/[^a-zA-Z0-9_]/g, '');
if (!dbName) { console.error('Invalid db name'); process.exit(1); }

const server = { host: process.env.IMS_MYSQL_HOST ?? process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD };

console.log(`Business: ${businessId}\nIMS schema: ${dbName}\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

if (!APPLY) { console.log('🔎 DRY RUN — re-run with --apply to create the schema.'); process.exit(0); }

// 1. Create the database.
const root = await createConnection(server);
await root.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await root.end();
console.log(`✔ database ${dbName} ready`);

// 2. Load schema DDL.
const conn = await createConnection({ ...server, database: dbName });
const sql = fs.readFileSync(path.resolve(__dirname, 'ims-schema.sql'), 'utf8');
const statements = sql.split(';').map(s => s.trim())
  .map(s => s.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n').trim())
  .filter(s => s.length && !s.toUpperCase().startsWith('SET NAMES'));
for (const stmt of statements) await conn.query(stmt);
console.log(`✔ ${statements.length} schema statements executed`);

// 3. Install business_id triggers.
const derive = (col) =>
  `SET NEW.business_id = IF(NEW.business_id IS NULL OR NEW.business_id = '',` +
  ` COALESCE((SELECT p.business_id FROM ims_product_variants v` +
  ` JOIN ims_products p ON p.product_id = v.product_id` +
  ` WHERE v.variant_id = NEW.${col} LIMIT 1), ''), NEW.business_id)`;
for (const t of [
  { name: 'trg_ims_stock_bizid', table: 'ims_stock', col: 'variant_id' },
  { name: 'trg_ims_sales_cache_bizid', table: 'ims_sales_cache', col: 'variant_id' },
]) {
  await conn.query(`DROP TRIGGER IF EXISTS \`${t.name}\``);
  await conn.query(`CREATE TRIGGER \`${t.name}\` BEFORE INSERT ON \`${t.table}\` FOR EACH ROW ${derive(t.col)}`);
}
console.log('✔ business_id triggers installed');
await conn.end();

// 4. Record the schema on the business row (main DB).
const main = await createConnection({ ...server, database: process.env.MYSQL_DATABASE });
await main.execute(`UPDATE businesses SET ims_db_name = ?, has_ims = 1 WHERE business_id = ?`, [dbName, businessId]);
await main.end();
console.log(`✔ businesses.ims_db_name = ${dbName}`);

console.log('\n✅ Provisioned.');
