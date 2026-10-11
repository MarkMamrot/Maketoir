#!/usr/bin/env node
/**
 * Backfill missing Monsterthreads variant Average Cost values.
 *
 * Source precedence:
 * 1. Latest active PO receipt's positive captured movement cost.
 * 2. Effective AUD cost derived from that receipt's current PO line when the
 *    legacy movement predates receipt cost snapshots.
 * 3. Positive variant Cost AUD.
 *
 * Historical stock movements and FIFO layers are never changed. The selected
 * cost is written to the authoritative ims_product_variants.avg_cost field.
 *
 * Usage:
 *   node scripts/backfill-avg-cost-monsterthreads.mjs
 *   node scripts/backfill-avg-cost-monsterthreads.mjs --apply \
 *     --confirm=BACKFILL-MONSTERTHREADS-AVERAGE-COST
 */

import path from 'path';
import fs from 'fs';

import 'dotenv/config';
import { createConnection } from 'mysql2/promise';

const BUSINESS_NAME = 'Monsterthreads';
const APPLY_CONFIRMATION = 'BACKFILL-MONSTERTHREADS-AVERAGE-COST';
const APPLY = process.argv.includes('--apply');
const confirmation = process.argv.find((argument) => argument.startsWith('--confirm='))?.slice('--confirm='.length);

if (APPLY && confirmation !== APPLY_CONFIRMATION) {
  throw new Error(`Apply requires --confirm=${APPLY_CONFIRMATION}`);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number > 0 ? number : null;
}

function roundCost(value) {
  return Math.round((finiteNumber(value) + Number.EPSILON) * 10_000) / 10_000;
}

function effectivePoLineCost(row) {
  const unitCost = positiveNumber(row.po_line_unit_cost);
  if (unitCost == null) return null;

  const discountPct = Math.min(100, Math.max(0, finiteNumber(row.discount_pct)));
  const discountedCost = unitCost * (1 - discountPct / 100);
  const taxRate = Math.max(0, finiteNumber(row.tax_rate));
  const exTaxCost = row.tax_treatment === 'inc_tax' && taxRate > 0
    ? discountedCost / (1 + taxRate)
    : discountedCost;
  const exchangeRate = positiveNumber(row.exchange_rate) ?? 1;
  const landedCost = Math.max(0, finiteNumber(row.landed_cost_per_unit));
  const effectiveCost = exTaxCost * exchangeRate + landedCost;
  return effectiveCost > 0 && Number.isFinite(effectiveCost) ? effectiveCost : null;
}

function buildPlan(candidates, receiptRows) {
  const receiptsByVariant = new Map();
  for (const row of receiptRows) {
    const rows = receiptsByVariant.get(row.variant_id) ?? [];
    rows.push(row);
    receiptsByVariant.set(row.variant_id, rows);
  }

  return candidates.map((candidate) => {
    const receipts = receiptsByVariant.get(candidate.variant_id) ?? [];
    const latestMovementId = receipts[0]?.movement_id ?? null;
    const latestRows = receipts.filter((row) => row.movement_id === latestMovementId);
    const capturedCost = positiveNumber(latestRows[0]?.movement_unit_cost);

    if (capturedCost != null) {
      return {
        ...candidate,
        selected_cost: roundCost(capturedCost),
        source: 'latest_receipt_movement',
        source_reference: latestRows[0].po_number,
        receipt_at: latestRows[0].receipt_at,
      };
    }

    const derivedCosts = [...new Set(
      latestRows
        .map(effectivePoLineCost)
        .filter((cost) => cost != null)
        .map((cost) => roundCost(cost)),
    )];
    if (derivedCosts.length === 1) {
      return {
        ...candidate,
        selected_cost: derivedCosts[0],
        source: 'latest_receipt_po_line',
        source_reference: latestRows[0].po_number,
        receipt_at: latestRows[0].receipt_at,
      };
    }

    const costAud = positiveNumber(candidate.cost_aud);
    if (costAud != null) {
      return {
        ...candidate,
        selected_cost: roundCost(costAud),
        source: derivedCosts.length > 1 ? 'cost_aud_ambiguous_receipt' : 'cost_aud',
        source_reference: null,
        receipt_at: null,
      };
    }

    return {
      ...candidate,
      selected_cost: null,
      source: derivedCosts.length > 1 ? 'unresolved_ambiguous_receipt' : 'unresolved_no_positive_cost',
      source_reference: latestRows[0]?.po_number ?? null,
      receipt_at: latestRows[0]?.receipt_at ?? null,
    };
  });
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function loadPlan(connection, businessId, lockCandidates) {
  const [candidates] = await connection.execute(
    `SELECT pv.variant_id, pv.sku, pv.avg_cost, pv.cost_aud, p.name AS product_name
       FROM ims_product_variants pv
       JOIN ims_products p ON p.product_id = pv.product_id
      WHERE BINARY p.business_id = BINARY ?
        AND COALESCE(p.is_stock_item, 1) = 1
        AND (pv.avg_cost IS NULL OR pv.avg_cost <= 0)
      ORDER BY pv.variant_id
      ${lockCandidates ? 'FOR UPDATE' : ''}`,
    [businessId],
  );

  if (candidates.length === 0) return [];

  const [receiptRows] = await connection.execute(
    `SELECT sm.variant_id,
            sm.id AS movement_id,
            sm.created_at AS receipt_at,
            sm.unit_cost AS movement_unit_cost,
            po.po_number,
            po.tax_treatment,
            po.exchange_rate,
            poi.id AS po_line_id,
            poi.unit_cost AS po_line_unit_cost,
            poi.discount_pct,
            poi.tax_rate,
            poi.landed_cost_per_unit
       FROM ims_stock_movements sm
       JOIN ims_product_variants pv ON BINARY pv.variant_id = BINARY sm.variant_id
       JOIN ims_products p ON p.product_id = pv.product_id
       JOIN ims_purchase_orders po
         ON sm.reference_type = 'purchase_order'
        AND po.id = sm.reference_id
        AND BINARY po.business_id = BINARY ?
       LEFT JOIN ims_purchase_order_items poi
         ON poi.po_id = po.id
        AND BINARY poi.variant_id = BINARY sm.variant_id
        AND poi.qty_received > 0
        AND (sm.source_line_id IS NULL OR poi.id = sm.source_line_id)
      WHERE BINARY p.business_id = BINARY ?
        AND BINARY sm.business_id = BINARY ?
        AND (pv.avg_cost IS NULL OR pv.avg_cost <= 0)
        AND sm.movement_type = 'po_received'
        AND sm.qty_change > 0
        AND po.status IN ('partially_received', 'complete')
      ORDER BY sm.variant_id, sm.created_at DESC, sm.id DESC, poi.id DESC`,
    [businessId, businessId, businessId],
  );

  return buildPlan(candidates, receiptRows);
}

async function applyPlan(connection, businessId, repairable) {
  const batchSize = 500;
  let updatedVariants = 0;

  for (let offset = 0; offset < repairable.length; offset += batchSize) {
    const batch = repairable.slice(offset, offset + batchSize);
    const caseSql = batch.map(() => 'WHEN ? THEN ?').join(' ');
    const variantIds = batch.map((row) => row.variant_id);
    const caseParams = batch.flatMap((row) => [row.variant_id, row.selected_cost]);
    const [variantResult] = await connection.execute(
      `UPDATE ims_product_variants pv
          JOIN ims_products p ON p.product_id = pv.product_id
          SET pv.avg_cost = CASE pv.variant_id ${caseSql} ELSE pv.avg_cost END
        WHERE BINARY p.business_id = BINARY ?
          AND (pv.avg_cost IS NULL OR pv.avg_cost <= 0)
          AND pv.variant_id IN (${placeholders(batch.length)})`,
      [...caseParams, businessId, ...variantIds],
    );
    updatedVariants += Number(variantResult.affectedRows ?? 0);

  }

  if (updatedVariants !== repairable.length) {
    throw new Error(`Expected to update ${repairable.length} variants, but updated ${updatedVariants}.`);
  }
  return { updatedVariants };
}

const mainConnection = await createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

let imsConnection;
let report;
try {
  const [businessRows] = await mainConnection.execute(
    `SELECT business_id, name, ims_db_name
       FROM businesses
      WHERE BINARY name = BINARY ?
        AND deleted_at IS NULL`,
    [BUSINESS_NAME],
  );
  if (businessRows.length !== 1) {
    throw new Error(`Expected exactly one active ${BUSINESS_NAME} business, found ${businessRows.length}.`);
  }

  const business = businessRows[0];
  if (!business.ims_db_name || !/^[A-Za-z0-9_]+$/.test(business.ims_db_name)) {
    throw new Error('Monsterthreads has no valid registered IMS schema.');
  }

  imsConnection = await createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: business.ims_db_name,
  });
  await imsConnection.beginTransaction();

  const [costingRows] = await imsConnection.execute(
    `SELECT active_method, active_epoch_id, revision
       FROM ims_inventory_cost_state
      WHERE BINARY business_id = BINARY ?
      LIMIT 1`,
    [business.business_id],
  );
  const costingState = costingRows[0] ?? { active_method: 'average_cost', active_epoch_id: null, revision: null };
  const plan = await loadPlan(imsConnection, business.business_id, APPLY);
  const repairable = plan.filter((row) => row.selected_cost != null && row.selected_cost > 0);
  const unresolved = plan.filter((row) => row.selected_cost == null || row.selected_cost <= 0);
  const sourceCounts = repairable.reduce((counts, row) => {
    counts[row.source] = (counts[row.source] ?? 0) + 1;
    return counts;
  }, {});

  console.log(`Business: ${business.name} (${business.business_id})`);
  console.log(`IMS schema: ${business.ims_db_name}`);
  console.log(`Costing state: ${costingState.active_method}, epoch ${costingState.active_epoch_id ?? 'none'}, revision ${costingState.revision ?? 'none'}`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Missing Average Cost stock variants: ${plan.length}`);
  console.log(`Repairable: ${repairable.length}`);
  console.log(`Unresolved: ${unresolved.length}`);
  console.table(Object.entries(sourceCounts).map(([source, count]) => ({ source, count })));
  console.table(repairable.slice(0, 30).map((row) => ({
    sku: row.sku,
    product: row.product_name,
    selected_cost: row.selected_cost,
    source: row.source,
    reference: row.source_reference,
  })));

  let updateResult = { updatedVariants: 0 };
  if (APPLY) {
    updateResult = await applyPlan(imsConnection, business.business_id, repairable);
    const [remainingRows] = await imsConnection.execute(
      `SELECT COUNT(*) AS count
         FROM ims_product_variants pv
         JOIN ims_products p ON p.product_id = pv.product_id
        WHERE BINARY p.business_id = BINARY ?
          AND COALESCE(p.is_stock_item, 1) = 1
          AND (pv.avg_cost IS NULL OR pv.avg_cost <= 0)`,
      [business.business_id],
    );
    if (Number(remainingRows[0].count) !== unresolved.length) {
      throw new Error(`Post-update verification found ${remainingRows[0].count} missing costs; expected ${unresolved.length}.`);
    }
    await imsConnection.commit();
  } else {
    await imsConnection.rollback();
  }

  report = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    business: { businessId: business.business_id, name: business.name, imsSchema: business.ims_db_name },
    costingState,
    summary: { candidates: plan.length, repairable: repairable.length, unresolved: unresolved.length, sourceCounts, ...updateResult },
    repairs: repairable,
    unresolved,
  };
} catch (error) {
  if (imsConnection) await imsConnection.rollback().catch(() => {});
  throw error;
} finally {
  await imsConnection?.end();
  await mainConnection.end();
}

const reportDirectory = path.resolve('tmp');
fs.mkdirSync(reportDirectory, { recursive: true });
const reportPath = path.join(reportDirectory, `monsterthreads-average-cost-backfill-${report.mode}.json`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`${APPLY ? 'Applied' : 'Dry run complete; no data changed'}. Report: ${reportPath}`);
