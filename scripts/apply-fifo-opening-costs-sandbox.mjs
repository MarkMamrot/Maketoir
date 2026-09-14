import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const APPLY = process.argv.includes('--apply');
const BUSINESS_ID = 'biz_monsterthreads_sandbox';
const SCHEMA_NAME = 'readyedu_MonsterthreadsSandboxIMS';
const SCHEMA = `\`${SCHEMA_NAME}\``;
const EXPECTED_MISSING_ROWS = 219;
const EXPECTED_VARIANTS = 99;
const EXPECTED_PROPOSED_VARIANTS = 90;
const EXPECTED_FALLBACK_VARIANTS = 9;
const SANDBOX_FALLBACK_COST = 0.01;

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  connectTimeout: 20_000,
});

let transactionStarted = false;
try {
  await connection.beginTransaction();
  transactionStarted = true;

  const [[business]] = await connection.execute(
    `SELECT business_id, ims_db_name, is_sandbox, automation_paused
       FROM businesses
      WHERE business_id = ? AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE`,
    [BUSINESS_ID],
  );
  if (!business || business.ims_db_name !== SCHEMA_NAME
    || Number(business.is_sandbox) !== 1 || Number(business.automation_paused) !== 1) {
    throw new Error('FIFO opening-cost apply blocked: exact paused sandbox identity check failed.');
  }

  const [[costingState]] = await connection.execute(
    `SELECT active_method, active_epoch_id, revision
       FROM ${SCHEMA}.ims_inventory_cost_state
      WHERE business_id = ?
      LIMIT 1
      FOR UPDATE`,
    [BUSINESS_ID],
  );
  if (!costingState || costingState.active_method !== 'average_cost'
    || costingState.active_epoch_id != null || Number(costingState.revision) !== 1) {
    throw new Error('FIFO opening-cost apply blocked: sandbox costing state changed.');
  }

  const [[negativeStock]] = await connection.execute(
    `SELECT COUNT(*) AS count
       FROM ${SCHEMA}.ims_stock
      WHERE business_id = ? AND qty_on_hand < -0.00005`,
    [BUSINESS_ID],
  );
  if (Number(negativeStock.count) !== 0) {
    throw new Error('FIFO opening-cost apply blocked: negative stock has returned.');
  }

  const [rows] = await connection.execute(
    `WITH latest_receipt AS (
       SELECT item.variant_id, item.unit_cost, po.received_date, po.id AS purchase_order_id,
              ROW_NUMBER() OVER (
                PARTITION BY item.variant_id
                ORDER BY COALESCE(po.received_date, DATE(po.updated_at), DATE(po.created_at)) DESC,
                         po.id DESC, item.id DESC
              ) AS receipt_rank
         FROM ${SCHEMA}.ims_purchase_order_items item
         JOIN ${SCHEMA}.ims_purchase_orders po
           ON po.id = item.po_id AND po.business_id = item.business_id
        WHERE item.business_id = ? AND item.qty_received > 0 AND item.unit_cost > 0
          AND po.status IN ('partially_received', 'complete')
     )
     SELECT stock.variant_id, stock.location_id, variant.sku, product.name AS product_name,
            stock.qty_on_hand, variant.cost_aud AS current_purchase_cost,
            receipt.unit_cost AS latest_receipt_cost, receipt.purchase_order_id
       FROM ${SCHEMA}.ims_stock stock
       JOIN ${SCHEMA}.ims_product_variants variant
         ON variant.business_id = stock.business_id AND variant.variant_id = stock.variant_id
       JOIN ${SCHEMA}.ims_products product
         ON product.business_id = variant.business_id AND product.product_id = variant.product_id
       LEFT JOIN latest_receipt receipt
         ON receipt.variant_id = stock.variant_id AND receipt.receipt_rank = 1
      WHERE stock.business_id = ? AND stock.qty_on_hand > 0.00005
        AND (COALESCE(variant.avg_cost, stock.avg_cost) IS NULL
          OR ROUND(COALESCE(variant.avg_cost, stock.avg_cost), 6) = 0)
      ORDER BY stock.variant_id, stock.location_id`,
    [BUSINESS_ID, BUSINESS_ID],
  );
  if (rows.length !== EXPECTED_MISSING_ROWS) {
    throw new Error(`FIFO opening-cost apply blocked: expected ${EXPECTED_MISSING_ROWS} missing rows, found ${rows.length}.`);
  }

  const variants = new Map();
  for (const row of rows) {
    const latestReceiptCost = Number(row.latest_receipt_cost ?? 0);
    const purchaseCost = Number(row.current_purchase_cost ?? 0);
    const cost = latestReceiptCost > 0
      ? latestReceiptCost
      : purchaseCost > 0
        ? purchaseCost
        : SANDBOX_FALLBACK_COST;
    const source = latestReceiptCost > 0
      ? 'latest_received_po'
      : purchaseCost > 0
        ? 'current_purchase_cost'
        : 'sandbox_nominal_fallback';
    const existing = variants.get(row.variant_id);
    if (existing && (existing.cost !== cost || existing.source !== source)) {
      throw new Error(`FIFO opening-cost apply blocked: conflicting recommendations for variant ${row.variant_id}.`);
    }
    variants.set(row.variant_id, {
      variantId: row.variant_id,
      sku: row.sku,
      productName: row.product_name,
      cost,
      source,
      purchaseOrderId: row.purchase_order_id ?? null,
    });
  }

  const proposedCount = [...variants.values()].filter(row => row.source !== 'sandbox_nominal_fallback').length;
  const fallbackCount = variants.size - proposedCount;
  if (variants.size !== EXPECTED_VARIANTS
    || proposedCount !== EXPECTED_PROPOSED_VARIANTS
    || fallbackCount !== EXPECTED_FALLBACK_VARIANTS) {
    throw new Error(`FIFO opening-cost apply blocked: expected ${EXPECTED_VARIANTS} variants (${EXPECTED_PROPOSED_VARIANTS} proposed, ${EXPECTED_FALLBACK_VARIANTS} fallback), found ${variants.size} (${proposedCount} proposed, ${fallbackCount} fallback).`);
  }

  const variantIds = [...variants.keys()];
  const placeholders = variantIds.map(() => '?').join(', ');
  const [lockedVariants] = await connection.execute(
    `SELECT variant_id
       FROM ${SCHEMA}.ims_product_variants
      WHERE business_id = ? AND variant_id IN (${placeholders})
      FOR UPDATE`,
    [BUSINESS_ID, ...variantIds],
  );
  if (lockedVariants.length !== EXPECTED_VARIANTS) {
    throw new Error('FIFO opening-cost apply blocked: one or more approved variants no longer exist.');
  }

  let updatedVariants = 0;
  let updatedStockRows = 0;
  if (APPLY) {
    for (const item of variants.values()) {
      const [variantResult] = await connection.execute(
        `UPDATE ${SCHEMA}.ims_product_variants
            SET avg_cost = ?
          WHERE business_id = ? AND variant_id = ?`,
        [item.cost, BUSINESS_ID, item.variantId],
      );
      const [stockResult] = await connection.execute(
        `UPDATE ${SCHEMA}.ims_stock
            SET avg_cost = ?
          WHERE business_id = ? AND variant_id = ?`,
        [item.cost, BUSINESS_ID, item.variantId],
      );
      updatedVariants += Number(variantResult.affectedRows);
      updatedStockRows += Number(stockResult.affectedRows);
    }

    const [[remaining]] = await connection.execute(
      `SELECT COUNT(*) AS count
         FROM ${SCHEMA}.ims_stock stock
         JOIN ${SCHEMA}.ims_product_variants variant
           ON variant.business_id = stock.business_id AND variant.variant_id = stock.variant_id
        WHERE stock.business_id = ? AND stock.qty_on_hand > 0.00005
          AND (COALESCE(variant.avg_cost, stock.avg_cost) IS NULL
            OR ROUND(COALESCE(variant.avg_cost, stock.avg_cost), 6) = 0)`,
      [BUSINESS_ID],
    );
    if (Number(remaining.count) !== 0 || updatedVariants !== EXPECTED_VARIANTS) {
      throw new Error(`FIFO opening-cost apply blocked: verification failed (${remaining.count} missing rows, ${updatedVariants} variants updated).`);
    }
    await connection.commit();
    transactionStarted = false;
  } else {
    await connection.rollback();
    transactionStarted = false;
  }

  const report = {
    mode: APPLY ? 'applied' : 'dry_run',
    businessId: BUSINESS_ID,
    schemaName: SCHEMA_NAME,
    missingStockRows: rows.length,
    variants: variants.size,
    sourcedVariants: proposedCount,
    fallbackVariants: fallbackCount,
    fallbackCost: SANDBOX_FALLBACK_COST,
    updatedVariants,
    updatedStockRows,
    costs: [...variants.values()],
  };
  const outputPath = path.resolve('tmp', `fifo-opening-cost-${APPLY ? 'application' : 'dry-run'}.json`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, costs: undefined, outputPath }, null, 2));
} catch (error) {
  if (transactionStarted) await connection.rollback();
  throw error;
} finally {
  await connection.end();
}