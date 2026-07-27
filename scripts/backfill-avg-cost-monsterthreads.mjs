#!/usr/bin/env node
/**
 * backfill-avg-cost-monsterthreads.mjs
 *
 * One-off backfill for Monsterthreads: for product variants that were received
 * via PO (movement_type = 'po_received') since 2026-07-01, set avg_cost =
 * cost_aud (the supplier cost price) on both ims_product_variants AND the
 * mirror on ims_stock, for variants where avg_cost is currently 0 or NULL.
 *
 * Run in dry-run mode by default; pass --apply to commit changes.
 *
 * Usage:
 *   node scripts/backfill-avg-cost-monsterthreads.mjs          # dry run
 *   node scripts/backfill-avg-cost-monsterthreads.mjs --apply  # commit
 */

import mysql from 'mysql2/promise';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// Load .env from project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const APPLY = process.argv.includes('--apply');
const SCHEMA = 'readyedu_MonsterthreadsIMS';
const CUTOFF = '2026-07-01';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST     || '127.0.0.1',
  port:     Number(process.env.MYSQL_PORT || 3306),
  user:     process.env.MYSQL_USER     || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: SCHEMA,
  multipleStatements: false,
});

console.log(`\nTarget schema : ${SCHEMA}`);
console.log(`Cutoff date   : ${CUTOFF}`);
console.log(`Mode          : ${APPLY ? 'APPLY (changes will be committed)' : 'DRY RUN (no changes written)'}\n`);

try {
  // 1. Find variant_ids that had po_received movements since cutoff
  const [movementRows] = await conn.execute(
    `SELECT DISTINCT variant_id
     FROM ims_stock_movements
     WHERE movement_type = 'po_received'
       AND created_at >= ?`,
    [CUTOFF],
  );

  const variantIds = movementRows.map(r => r.variant_id).filter(Boolean);
  console.log(`Variants with po_received movements since ${CUTOFF}: ${variantIds.length}`);

  if (variantIds.length === 0) {
    console.log('Nothing to backfill.');
    await conn.end();
    process.exit(0);
  }

  // 2. Of those, find ones where avg_cost is 0 or NULL but cost_aud > 0
  const placeholders = variantIds.map(() => '?').join(', ');
  const [candidates] = await conn.execute(
    `SELECT variant_id, sku, avg_cost, cost_aud
     FROM ims_product_variants
     WHERE variant_id IN (${placeholders})
       AND (avg_cost IS NULL OR avg_cost = 0)
       AND cost_aud > 0`,
    variantIds,
  );

  console.log(`Candidates with avg_cost = 0 and cost_aud > 0: ${candidates.length}`);
  if (candidates.length === 0) {
    console.log('Nothing to backfill.');
    await conn.end();
    process.exit(0);
  }

  for (const row of candidates) {
    console.log(`  ${row.sku ?? row.variant_id}: avg_cost=${row.avg_cost} → cost_aud=${row.cost_aud}`);
  }

  if (!APPLY) {
    console.log('\nDry run — pass --apply to commit these changes.');
    await conn.end();
    process.exit(0);
  }

  // 3. Apply: UPDATE ims_product_variants
  const candidateIds = candidates.map(r => r.variant_id);
  const phCandidates = candidateIds.map(() => '?').join(', ');

  const [pvResult] = await conn.execute(
    `UPDATE ims_product_variants
     SET avg_cost = cost_aud
     WHERE variant_id IN (${phCandidates})
       AND (avg_cost IS NULL OR avg_cost = 0)
       AND cost_aud > 0`,
    candidateIds,
  );
  console.log(`\nUpdated ims_product_variants: ${pvResult.affectedRows} rows`);

  // 4. Mirror: UPDATE ims_stock (all locations for each variant)
  const [stockResult] = await conn.execute(
    `UPDATE ims_stock s
     JOIN ims_product_variants pv USING (variant_id)
     SET s.avg_cost = pv.avg_cost
     WHERE s.variant_id IN (${phCandidates})`,
    candidateIds,
  );
  console.log(`Updated ims_stock (all locations): ${stockResult.affectedRows} rows`);

  console.log('\nBackfill complete.');
} finally {
  await conn.end();
}
