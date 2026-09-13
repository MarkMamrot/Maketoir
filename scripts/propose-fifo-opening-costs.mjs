import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const businessId = 'biz_monsterthreads_sandbox';
const schemaName = 'readyedu_MonsterthreadsSandboxIMS';
const schema = `\`${schemaName}\``;

function csvValue(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  connectTimeout: 20_000,
});

try {
  const [[business]] = await connection.query(
    `SELECT ims_db_name, is_sandbox, automation_paused
       FROM businesses
      WHERE business_id = ? AND deleted_at IS NULL
      LIMIT 1`,
    [businessId],
  );
  if (!business || business.ims_db_name !== schemaName
    || Number(business.is_sandbox) !== 1 || Number(business.automation_paused) !== 1) {
    throw new Error('FIFO cost proposal blocked: exact paused sandbox identity check failed.');
  }

  const [rows] = await connection.query(
    `WITH latest_receipt AS (
       SELECT item.variant_id, item.unit_cost, po.received_date, po.id AS purchase_order_id,
              ROW_NUMBER() OVER (
                PARTITION BY item.variant_id
                ORDER BY COALESCE(po.received_date, DATE(po.updated_at), DATE(po.created_at)) DESC, po.id DESC, item.id DESC
              ) AS receipt_rank
         FROM ${schema}.ims_purchase_order_items item
         JOIN ${schema}.ims_purchase_orders po ON po.id = item.po_id AND po.business_id = item.business_id
        WHERE item.business_id = ? AND item.qty_received > 0 AND item.unit_cost > 0
          AND po.status IN ('partially_received', 'complete')
     )
     SELECT stock.variant_id, stock.location_id, location.name AS location_name,
            variant.sku, product.name AS product_name, stock.qty_on_hand,
            variant.avg_cost, stock.avg_cost AS location_avg_cost, variant.cost_aud AS current_purchase_cost,
            receipt.unit_cost AS latest_receipt_cost, receipt.received_date AS latest_receipt_date,
            receipt.purchase_order_id
       FROM ${schema}.ims_stock stock
       JOIN ${schema}.ims_product_variants variant
         ON variant.business_id = stock.business_id AND variant.variant_id = stock.variant_id
       JOIN ${schema}.ims_products product
         ON product.business_id = variant.business_id AND product.product_id = variant.product_id
       JOIN ${schema}.ims_locations location
         ON location.business_id = stock.business_id AND location.id = stock.location_id
      LEFT JOIN latest_receipt receipt ON receipt.variant_id = stock.variant_id AND receipt.receipt_rank = 1
      WHERE stock.business_id = ? AND stock.qty_on_hand > 0.00005
        AND (COALESCE(variant.avg_cost, stock.avg_cost) IS NULL
          OR ROUND(COALESCE(variant.avg_cost, stock.avg_cost), 6) = 0)
      ORDER BY product.name, variant.sku, stock.location_id`,
    [businessId, businessId],
  );

  const outputRows = rows.map(row => {
    const receiptCost = Number(row.latest_receipt_cost ?? 0);
    const purchaseCost = Number(row.current_purchase_cost ?? 0);
    const recommendedCost = receiptCost > 0 ? receiptCost : purchaseCost > 0 ? purchaseCost : null;
    const recommendationSource = receiptCost > 0 ? 'latest_received_po' : purchaseCost > 0 ? 'current_purchase_cost' : 'unresolved';
    return {
      variant_id: row.variant_id,
      sku: row.sku,
      product_name: row.product_name,
      location_id: row.location_id,
      location_name: row.location_name,
      qty_on_hand: row.qty_on_hand,
      current_variant_avg_cost: row.avg_cost,
      current_location_avg_cost: row.location_avg_cost,
      current_purchase_cost: row.current_purchase_cost,
      latest_receipt_cost: row.latest_receipt_cost,
      latest_receipt_date: row.latest_receipt_date instanceof Date ? row.latest_receipt_date.toISOString().slice(0, 10) : row.latest_receipt_date,
      purchase_order_id: row.purchase_order_id,
      recommended_cost: recommendedCost,
      recommendation_source: recommendationSource,
      review_status: recommendedCost == null ? 'unresolved' : 'proposed',
    };
  });
  const headers = Object.keys(outputRows[0] ?? {
    variant_id: '', sku: '', product_name: '', location_id: '', location_name: '', qty_on_hand: '',
    current_variant_avg_cost: '', current_location_avg_cost: '', current_purchase_cost: '',
    latest_receipt_cost: '', latest_receipt_date: '', purchase_order_id: '', recommended_cost: '',
    recommendation_source: '', review_status: '',
  });
  const csv = [headers.join(','), ...outputRows.map(row => headers.map(header => csvValue(row[header])).join(','))].join('\n');
  const outputPath = path.resolve('tmp', 'fifo-opening-cost-proposal.csv');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${csv}\n`, 'utf8');

  const proposed = outputRows.filter(row => row.review_status === 'proposed').length;
  console.log(JSON.stringify({ outputPath, rows: outputRows.length, proposed, unresolved: outputRows.length - proposed }, null, 2));
} finally {
  await connection.end();
}