/**
 * Systemic business_id integrity fix for the IMS database.
 *
 * Two tables are filtered directly by business_id in app queries yet get rows
 * created in many code paths that historically omitted it (ims_stock via the
 * PO/SO/receive/transfer/stocktake flows; ims_sales_cache via refreshVariantCache).
 * Empty business_id makes those rows invisible to the business-scoped queries.
 *
 * This installs BEFORE INSERT triggers that auto-derive business_id from the
 * variant's product whenever it is omitted, and backfills existing empty rows.
 * Bulletproof: covers every current and future insert path.
 *
 *   node scripts/fix-business-id-integrity.mjs          (dry run — shows plan)
 *   node scripts/fix-business-id-integrity.mjs --apply   (install triggers + backfill)
 */
import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const APPLY = process.argv.includes('--apply');
const ims = await createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
  multipleStatements: false,
});

// Single-statement trigger bodies (no BEGIN/END → no DELIMITER needed via driver).
const deriveExpr = (col) =>
  `SET NEW.business_id = IF(NEW.business_id IS NULL OR NEW.business_id = '',` +
  ` COALESCE((SELECT p.business_id FROM ims_product_variants v` +
  ` JOIN ims_products p ON p.product_id = v.product_id` +
  ` WHERE v.variant_id = NEW.${col} LIMIT 1), ''), NEW.business_id)`;

const triggers = [
  { name: 'trg_ims_stock_bizid',       table: 'ims_stock',       body: deriveExpr('variant_id') },
  { name: 'trg_ims_sales_cache_bizid', table: 'ims_sales_cache', body: deriveExpr('variant_id') },
];

async function emptyCount(table) {
  const [[r]] = await ims.execute(
    `SELECT COUNT(*) AS n FROM \`${table}\` WHERE business_id IS NULL OR business_id = ''`);
  return Number(r.n);
}

try {
  console.log('BEFORE:');
  for (const t of triggers) console.log(`  ${t.table}: ${await emptyCount(t.table)} empty business_id rows`);

  if (!APPLY) {
    console.log('\nWould install triggers:', triggers.map(t => t.name).join(', '));
    console.log('Would backfill empty business_id rows on:', triggers.map(t => t.table).join(', '));
    console.log('\n🔎 DRY RUN — no changes. Re-run with --apply.');
  } else {
    for (const t of triggers) {
      await ims.query(`DROP TRIGGER IF EXISTS \`${t.name}\``);
      await ims.query(
        `CREATE TRIGGER \`${t.name}\` BEFORE INSERT ON \`${t.table}\` FOR EACH ROW ${t.body}`);
      console.log(`  ✔ trigger ${t.name} installed on ${t.table}`);

      // Backfill existing empty rows via the same derivation.
      const [res] = await ims.execute(
        `UPDATE \`${t.table}\` s
           JOIN ims_product_variants v ON v.variant_id = s.variant_id
           JOIN ims_products p ON p.product_id = v.product_id
            SET s.business_id = p.business_id
          WHERE (s.business_id IS NULL OR s.business_id = '')
            AND p.business_id IS NOT NULL AND p.business_id <> ''`);
      console.log(`  ✔ backfilled ${res.affectedRows} rows on ${t.table}`);
    }
    console.log('\nAFTER:');
    for (const t of triggers) console.log(`  ${t.table}: ${await emptyCount(t.table)} empty business_id rows`);
    console.log('\n✅ APPLIED.');
  }
} catch (e) {
  console.error('\n❌ ERROR:', e.message);
} finally {
  await ims.end();
}
