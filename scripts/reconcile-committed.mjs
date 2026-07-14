/**
 * Reconcile ims_stock.qty_committed against the real open commitments.
 *
 * qty_committed at a (variant, location) should equal:
 *   Σ qty_ordered  from ims_sales_orders     with status = 'confirmed' at that location
 * + Σ qty_sent     from ims_branch_transfers with status = 'sent'      from that location
 *
 * Anything else is drift (e.g. an order whose status was changed outside
 * ImsSORepo.changeStatus, or a historical import that reset an order to
 * 'fulfilled' without releasing its commitment).
 *
 * Usage:
 *   node scripts/reconcile-committed.mjs            # dry-run: report drift only
 *   node scripts/reconcile-committed.mjs --apply     # write corrections
 *   node scripts/reconcile-committed.mjs --sku UG164174   # limit to one SKU
 */
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]/, '').replace(/['"]$/, '')]; })
);

const APPLY = process.argv.includes('--apply');
const skuIdx = process.argv.indexOf('--sku');
const ONLY_SKU = skuIdx >= 0 ? process.argv[skuIdx + 1] : null;

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST, port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.IMS_MYSQL_DATABASE,
});

// Expected committed per (variant, location) from open confirmed sales orders.
const [soExpect] = await conn.execute(
  `SELECT soi.variant_id, so.location_id, SUM(soi.qty_ordered) AS qty
     FROM ims_sales_order_items soi
     JOIN ims_sales_orders so ON so.id = soi.so_id
    WHERE so.status = 'confirmed'
    GROUP BY soi.variant_id, so.location_id`
);
// Expected committed per (variant, location) from in-transit branch transfers.
const [btExpect] = await conn.execute(
  `SELECT bti.variant_id, bt.from_location_id AS location_id, SUM(bti.qty_sent) AS qty
     FROM ims_branch_transfer_items bti
     JOIN ims_branch_transfers bt ON bt.id = bti.transfer_id
    WHERE bt.status = 'sent'
    GROUP BY bti.variant_id, bt.from_location_id`
);

const expected = new Map(); // key: variant|location -> qty
const add = (v, l, q) => {
  const k = `${v}|${l}`;
  expected.set(k, (expected.get(k) ?? 0) + Number(q));
};
for (const r of soExpect) add(r.variant_id, r.location_id, r.qty);
for (const r of btExpect) add(r.variant_id, r.location_id, r.qty);

// Actual committed rows (only where committed <> 0, plus any expected key).
const [actualRows] = await conn.execute(
  `SELECT s.variant_id, s.location_id, s.qty_committed, s.qty_on_hand,
          v.sku, p.name, l.name AS location
     FROM ims_stock s
     JOIN ims_product_variants v ON v.variant_id = s.variant_id
     JOIN ims_products p ON p.product_id = v.product_id
     JOIN ims_locations l ON l.id = s.location_id
    WHERE s.qty_committed <> 0
       OR (s.variant_id, s.location_id) IN (
            SELECT soi.variant_id, so.location_id FROM ims_sales_order_items soi
              JOIN ims_sales_orders so ON so.id = soi.so_id WHERE so.status='confirmed'
            UNION
            SELECT bti.variant_id, bt.from_location_id FROM ims_branch_transfer_items bti
              JOIN ims_branch_transfers bt ON bt.id = bti.transfer_id WHERE bt.status='sent'
          )`
);

const drift = [];     // existing stock rows whose committed is wrong — safe to auto-fix
const missing = [];   // open commitments with no stock row — needs manual review
const seen = new Set();
for (const r of actualRows) {
  const k = `${r.variant_id}|${r.location_id}`;
  seen.add(k);
  if (ONLY_SKU && r.sku !== ONLY_SKU) continue;
  const exp = expected.get(k) ?? 0;
  const act = Number(r.qty_committed);
  if (Math.abs(exp - act) > 1e-6) {
    drift.push({ sku: r.sku, name: r.name, location: r.location,
      on_hand: Number(r.qty_on_hand), committed_now: act, committed_should_be: exp,
      variant_id: r.variant_id, location_id: r.location_id });
  }
}
// Also catch commitments that SHOULD exist but have a zero/missing stock row.
for (const [k, exp] of expected) {
  if (seen.has(k) || exp === 0) continue;
  const [v, l] = k.split('|');
  if (ONLY_SKU) {
    const [[chk]] = await conn.execute(`SELECT sku FROM ims_product_variants WHERE variant_id = ?`, [v]);
    if (!chk || chk.sku !== ONLY_SKU) continue;
  }
  missing.push({ location_id: Number(l), committed_should_be: exp, variant_id: v });
}

if (drift.length === 0 && missing.length === 0) {
  console.log('No committed-stock drift found. Everything reconciles.');
} else {
  if (drift.length) {
    console.log(`Found ${drift.length} stock row(s) with committed drift:\n`);
    console.table(drift.map(({ variant_id, location_id, ...show }) => show));
  }
  if (missing.length) {
    console.log(`\n${missing.length} open commitment(s) have NO stock row at the source ` +
      `(sent BT / confirmed SO for stock that was never on hand). These are NOT auto-fixed — review manually:\n`);
    console.table(missing);
  }

  if (APPLY) {
    let fixed = 0;
    for (const d of drift) {
      await conn.execute(
        `UPDATE ims_stock SET qty_committed = ? WHERE variant_id = ? AND location_id = ?`,
        [d.committed_should_be, d.variant_id, d.location_id]
      );
      fixed++;
    }
    console.log(`\nApplied ${fixed} correction(s) to existing stock rows. ` +
      `qty_committed now matches open commitments.` +
      (missing.length ? ` (${missing.length} no-stock-row case(s) left untouched.)` : ''));
  } else {
    console.log('\nDry-run only. Re-run with --apply to write the stock-row corrections above.');
  }
}

await conn.end();
