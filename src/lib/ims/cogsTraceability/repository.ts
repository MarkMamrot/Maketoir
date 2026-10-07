import 'server-only';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import { numberOrNull } from './domain';
import type { Allocation, Movement, SalesLine } from './projection';
import { ReportValidationError, type ReportRequest } from './request';

const LIMIT = 50000;
const movementTypes = "'pos_sale','pos_return','so_fulfilled','cn_returned','cn_return_reversed'";
type Raw = Record<string, any>;
const textDate = (value: unknown): string => value instanceof Date ? value.toISOString().slice(0, 19).replace('T', ' ') : String(value ?? '');
const nullableDate = (value: unknown): string | null => value == null ? null : textDate(value);

async function bounded(sql: string, params: unknown[]): Promise<Raw[]> {
  const rows = await imsQuery<Raw>(`${sql} LIMIT ${LIMIT + 1}`, params);
  if (rows.length > LIMIT) throw new ReportValidationError('This range exceeds 50,000 source records. Narrow the date range; no figures have been truncated.');
  return rows;
}

function normalise(raw: Raw): SalesLine {
  return { ...raw, documentId: Number(raw.documentId), lineId: Number(raw.lineId), locationId: Number(raw.locationId),
    qty: Number(raw.qty), gross: Number(raw.gross), lineTotal: Number(raw.lineTotal), taxRate: Number(raw.taxRate),
    headerDiscount: Number(raw.headerDiscount), headerNet: Number(raw.headerNet), headerTax: Number(raw.headerTax),
    exchangeRate: numberOrNull(raw.exchangeRate), saleDate: textDate(raw.saleDate), reversedAt: nullableDate(raw.reversedAt),
    historical: Number(raw.historical) !== 0, stockItem: Number(raw.stockItem) !== 0, restock: Number(raw.restock) !== 0 } as SalesLine;
}

function documentCondition(alias: string, referenceType: string, dateExpression: string, request: ReportRequest): string {
  return request.basis === 'sale' ? `${dateExpression} >= ? AND ${dateExpression} < ?`
    : `(${dateExpression} >= ? AND ${dateExpression} < ? OR EXISTS (
         SELECT 1 FROM ims_stock_movements selected
          WHERE selected.reference_type = '${referenceType}' AND selected.reference_id = ${alias}.id
            AND selected.movement_type IN (${movementTypes}) AND selected.created_at >= ? AND selected.created_at < ?))`;
}

export async function loadEvidence(businessId: string, request: ReportRequest) {
  const dates = [request.from, request.toExclusive];
  const documentDates = request.basis === 'sale' ? dates : [...dates, ...dates];
  const posRows = await bounded(`SELECT 'pos' AS source, ps.id AS documentId, item.id AS lineId, item.variant_id AS variantId,
      CONCAT('POS-', ps.id) AS orderRef, NULL AS invoiceNo, DATE_FORMAT(ps.completed_at, '%Y-%m-%d %H:%i:%s') AS saleDate,
      COALESCE(ps.customer_name, contact.name) AS customer, 'POS' AS channel, NULL AS channelInstance,
      ps.cashier_name AS cashier, product.brand, COALESCE(item.code, variant.sku) AS sku, item.name AS description,
      location.name AS warehouse, ps.location_id AS locationId, ps.status, 'AUD' AS currency, 1 AS exchangeRate,
      item.qty, item.qty * COALESCE(item.original_price, item.unit_price) AS gross, item.line_total AS lineTotal,
      item.tax_rate / 100 AS taxRate, 'inc_tax' AS taxBasis,
      CASE WHEN ps.sale_type = 'return' THEN 0 ELSE GREATEST(0, ps.discount_total - (
        SELECT COALESCE(SUM(discount_amount), 0) FROM pos_sale_items WHERE sale_id = ps.id)) END AS headerDiscount,
      CASE WHEN ps.sale_type = 'return' AND ps.credit_note_id IS NOT NULL THEN (
        SELECT COALESCE(SUM(line_total / (1 + tax_rate / 100)), 0) FROM pos_sale_items WHERE sale_id = ps.id AND qty > 0
      ) ELSE ps.total - ps.tax_total END AS headerNet,
      CASE WHEN ps.sale_type = 'return' AND ps.credit_note_id IS NOT NULL THEN (
        SELECT COALESCE(SUM(line_total - line_total / (1 + tax_rate / 100)), 0) FROM pos_sale_items WHERE sale_id = ps.id AND qty > 0
      ) ELSE ps.tax_total END AS headerTax,
      ps.is_historical AS historical, CASE WHEN item.is_gift_card = 1 THEN 0 ELSE COALESCE(product.is_stock_item, 1) END AS stockItem,
      1 AS restock, NULL AS creditRef, NULL AS reversedAt
    FROM pos_sales ps JOIN pos_sale_items item ON item.sale_id = ps.id
    LEFT JOIN ims_product_variants variant ON BINARY variant.variant_id = BINARY item.variant_id
    LEFT JOIN ims_products product ON BINARY product.product_id = BINARY variant.product_id
    LEFT JOIN ims_contacts contact ON contact.id = ps.customer_id
    LEFT JOIN ims_locations location ON location.id = ps.location_id
    WHERE ps.is_historical = 0 AND ps.status IN ('completed','layby_complete')
      AND (ps.sale_type <> 'return' OR item.qty > 0 OR ps.credit_note_id IS NULL)
      AND ${documentCondition('ps', 'pos_sale', 'ps.completed_at', request)} ORDER BY ps.id, item.id`, documentDates);
  const soRows = await bounded(`SELECT 'so' AS source, so.id AS documentId, item.id AS lineId, item.variant_id AS variantId,
      COALESCE(so.shopify_order_name, so.so_number) AS orderRef, so.xero_invoice_number AS invoiceNo, DATE_FORMAT(so.order_date, '%Y-%m-%d') AS saleDate,
      contact.name AS customer, CASE WHEN so.so_type = 'online' THEN COALESCE(so.sales_channel, 'Online (legacy)') ELSE 'Wholesale' END AS channel,
      so.channel_instance_id AS channelInstance, NULL AS cashier, product.brand, variant.sku, product.name AS description,
      location.name AS warehouse, so.location_id AS locationId, so.status, so.currency_code AS currency, so.exchange_rate AS exchangeRate,
      item.qty_ordered AS qty, item.qty_ordered * item.unit_price AS gross, item.line_total AS lineTotal,
      item.tax_rate AS taxRate, so.tax_treatment AS taxBasis, so.discount AS headerDiscount,
      so.total_amount - so.tax_amount AS headerNet, so.tax_amount AS headerTax, so.is_historical AS historical,
      COALESCE(product.is_stock_item, 1) AS stockItem, 1 AS restock, NULL AS creditRef, NULL AS reversedAt
    FROM ims_sales_orders so JOIN ims_sales_order_items item ON item.so_id = so.id
    LEFT JOIN ims_product_variants variant ON BINARY variant.variant_id = BINARY item.variant_id
    LEFT JOIN ims_products product ON BINARY product.product_id = BINARY variant.product_id
    LEFT JOIN ims_contacts contact ON contact.id = so.customer_id
    LEFT JOIN ims_locations location ON location.id = so.location_id
    WHERE so.cin7_order_id IS NULL AND so.is_historical = 0 AND so.is_staff_preview_test = 0
      AND so.status NOT IN ('draft','cancelled')
      AND ${documentCondition('so', 'sales_order', 'so.order_date', request)} ORDER BY so.id, item.id`, documentDates);
  const creditRows = await bounded(`SELECT 'credit' AS source, cn.id AS documentId, item.id AS lineId, item.variant_id AS variantId,
      COALESCE(so.so_number, cn.original_so_number, cn.reference, cn.cn_number) AS orderRef, NULL AS invoiceNo,
      DATE_FORMAT(COALESCE(cn.completed_at, cn.cn_date), '%Y-%m-%d %H:%i:%s') AS saleDate, contact.name AS customer,
      CASE WHEN cn.source = 'pos' THEN 'POS' WHEN so.so_type = 'online' THEN COALESCE(so.sales_channel, cn.source)
           WHEN cn.so_id IS NOT NULL THEN 'Wholesale' ELSE 'Returns (unlinked)' END AS channel,
      COALESCE(cn.channel_instance_id, so.channel_instance_id) AS channelInstance, NULL AS cashier,
      product.brand, COALESCE(item.code, variant.sku) AS sku, COALESCE(item.name, product.name) AS description,
      location.name AS warehouse, cn.location_id AS locationId, cn.status, 'AUD' AS currency, 1 AS exchangeRate,
      item.qty, item.qty * item.unit_price AS gross, item.line_total AS lineTotal,
      item.tax_rate AS taxRate, cn.tax_treatment AS taxBasis, 0 AS headerDiscount,
      cn.total_amount - cn.tax_amount AS headerNet, cn.tax_amount AS headerTax,
      COALESCE(ps.is_historical, so.is_historical, 0) AS historical, COALESCE(product.is_stock_item, 1) AS stockItem,
      item.restock, cn.cn_number AS creditRef, DATE_FORMAT(cn.reversed_at, '%Y-%m-%d %H:%i:%s') AS reversedAt
    FROM ims_credit_notes cn JOIN ims_credit_note_items item ON item.cn_id = cn.id
    LEFT JOIN ims_sales_orders so ON so.id = cn.so_id
    LEFT JOIN pos_sales ps ON ps.id = cn.pos_sale_id
    LEFT JOIN ims_product_variants variant ON BINARY variant.variant_id = BINARY item.variant_id
    LEFT JOIN ims_products product ON BINARY product.product_id = BINARY variant.product_id
    LEFT JOIN ims_contacts contact ON contact.id = cn.customer_id
    LEFT JOIN ims_locations location ON location.id = cn.location_id
    WHERE cn.status IN ('complete','reversed') AND (
      ${documentCondition('cn', 'credit_note', 'COALESCE(cn.completed_at, cn.cn_date)', request)}
      OR cn.reversed_at >= ? AND cn.reversed_at < ?) ORDER BY cn.id, item.id`, [...documentDates, ...dates]);
  const historyRows = request.basis === 'sale' ? await bounded(`SELECT 'history' AS source, history.id AS documentId, history.id AS lineId,
      history.variant_id AS variantId, COALESCE(history.reference, history.cin7_order_id) AS orderRef,
      NULL AS invoiceNo, DATE_FORMAT(history.invoice_date, '%Y-%m-%d') AS saleDate, NULL AS customer,
      COALESCE(history.source, 'Imported history') AS channel, NULL AS channelInstance, NULL AS cashier,
      product.brand, history.sku, history.product_name AS description, location.name AS warehouse,
      history.branch_id AS locationId, history.stage AS status, 'Unknown' AS currency, NULL AS exchangeRate,
      history.qty, history.unit_price * history.qty AS gross, history.line_total AS lineTotal,
      0 AS taxRate, 'unknown' AS taxBasis, 0 AS headerDiscount, history.line_total AS headerNet,
      0 AS headerTax, 1 AS historical, 1 AS stockItem, 1 AS restock, NULL AS creditRef, NULL AS reversedAt
    FROM ims_sales_history history
    LEFT JOIN ims_product_variants variant ON BINARY variant.variant_id = BINARY history.variant_id
    LEFT JOIN ims_products product ON BINARY product.product_id = BINARY variant.product_id
    LEFT JOIN ims_locations location ON location.id = history.branch_id
    WHERE history.invoice_date >= ? AND history.invoice_date < ? ORDER BY history.id`, dates) : [];
  const lines = [...posRows, ...soRows, ...creditRows, ...historyRows].map(normalise);
  if (lines.length > LIMIT) throw new ReportValidationError('More than 50,000 sale lines match this range. Narrow the range; no figures have been truncated.');

  const movementSelect = `SELECT sm.id, sm.reference_id AS documentId, sm.reference_type AS referenceType,
      sm.source_line_id AS sourceLineId, sm.variant_id AS variantId, sm.location_id AS locationId,
      location.name AS warehouse, DATE_FORMAT(sm.created_at, '%Y-%m-%d %H:%i:%s') AS date, sm.movement_type AS type, sm.qty_change AS qtyChange,
      sm.unit_cost AS unitCost, sm.cost_method_snapshot AS costMethod,
      CASE WHEN sm.movement_type = 'pos_sale' THEN COALESCE(ps.is_historical, 0)
           WHEN sm.movement_type = 'so_fulfilled' THEN (COALESCE(so.is_historical, 0) <> 0 OR so.cin7_order_id IS NOT NULL)
           WHEN cn.source = 'pos' THEN COALESCE(return_sale.is_historical, 0) ELSE 0 END AS historical,
      COALESCE(product.is_stock_item, 1) AS stockItem
    FROM ims_stock_movements sm
    LEFT JOIN ims_locations location ON location.id = sm.location_id
    LEFT JOIN pos_sales ps ON sm.reference_type = 'pos_sale' AND ps.id = sm.reference_id
    LEFT JOIN ims_sales_orders so ON sm.reference_type = 'sales_order' AND so.id = sm.reference_id
    LEFT JOIN ims_credit_notes cn ON sm.reference_type = 'credit_note' AND cn.id = sm.reference_id
    LEFT JOIN pos_sales return_sale ON cn.source = 'pos' AND return_sale.id = cn.pos_sale_id
    LEFT JOIN ims_product_variants variant ON BINARY variant.variant_id = BINARY sm.variant_id
    LEFT JOIN ims_products product ON BINARY product.product_id = BINARY variant.product_id
    WHERE sm.movement_type IN (${movementTypes})`;
  const movementMap = new Map<number, Movement>();
  const addMovements = (rawRows: Raw[]) => {
    for (const raw of rawRows) movementMap.set(Number(raw.id), { ...raw, id: Number(raw.id), documentId: Number(raw.documentId),
      sourceLineId: numberOrNull(raw.sourceLineId), locationId: Number(raw.locationId), date: textDate(raw.date),
      qtyChange: Number(raw.qtyChange), unitCost: numberOrNull(raw.unitCost), historical: Number(raw.historical) !== 0,
      stockItem: Number(raw.stockItem) !== 0 } as Movement);
    if (movementMap.size > LIMIT) throw new ReportValidationError('More than 50,000 stock events match these documents. Narrow the range.');
  };
  if (request.basis === 'movement') addMovements(await bounded(`${movementSelect} AND sm.created_at >= ? AND sm.created_at < ? ORDER BY sm.id`, dates));
  for (const [source, reference] of [['pos', 'pos_sale'], ['so', 'sales_order'], ['credit', 'credit_note']] as const) {
    const ids = [...new Set(lines.filter(line => line.source === source).map(line => line.documentId))];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      addMovements(await bounded(`${movementSelect} AND sm.reference_type = ? AND sm.reference_id IN (${batch.map(() => '?').join(',')}) ORDER BY sm.id`, [reference, ...batch]));
    }
  }
  const movements = Array.from(movementMap.values());
  const allocations: Allocation[] = [];
  const movementIds = movements.map(movement => movement.id);
  for (let offset = 0; offset < movementIds.length; offset += 500) {
    const batch = movementIds.slice(offset, offset + 500);
    const rawRows = await bounded(`SELECT allocation.id, allocation.stock_movement_id AS movementId,
        layer.id AS layerId, layer.parent_layer_id AS parentLayerId, layer.source_type AS sourceType,
        po.po_number AS poRef, DATE_FORMAT(layer.fifo_date, '%Y-%m-%d %H:%i:%s') AS receiptDate, allocation.quantity AS qty,
        allocation.unit_cost AS unitCost, allocation.allocated_value AS value, allocation.allocation_type AS type
      FROM ims_fifo_cost_allocations allocation JOIN ims_fifo_cost_layers layer
        ON layer.id = allocation.layer_id AND BINARY layer.business_id = BINARY allocation.business_id
      LEFT JOIN ims_purchase_orders po ON layer.source_reference_type = 'purchase_order' AND po.id = layer.source_reference_id
      WHERE allocation.business_id = ? AND allocation.stock_movement_id IN (${batch.map(() => '?').join(',')}) ORDER BY allocation.id`, [businessId, ...batch]);
    allocations.push(...rawRows.map(raw => ({ ...raw, id: Number(raw.id), movementId: Number(raw.movementId), layerId: Number(raw.layerId),
      parentLayerId: numberOrNull(raw.parentLayerId), qty: Number(raw.qty), unitCost: Number(raw.unitCost), value: Number(raw.value), receiptDate: textDate(raw.receiptDate) } as Allocation)));
    if (allocations.length > LIMIT * 4) throw new ReportValidationError('Too many FIFO allocations. Narrow the date range.');
  }
  const soIds = [...new Set(lines.filter(line => line.source === 'so').map(line => String(line.documentId)))];
  for (let offset = 0; offset < soIds.length; offset += 500) {
    const batch = soIds.slice(offset, offset + 500);
    const snapshots = await query<{ reference_id: string; xero_id: string; live_snapshot: unknown }>(
      `SELECT reference_id, xero_id, live_snapshot FROM xero_reconciliation_targets
        WHERE business_id = ? AND target_type = 'sales_order' AND reference_id IN (${batch.map(() => '?').join(',')})`, [businessId, ...batch]);
    for (const snapshot of snapshots) {
      let live: any = snapshot.live_snapshot;
      if (typeof live === 'string') { try { live = JSON.parse(live); } catch { live = null; } }
      if (live && typeof live.status === 'string' && live.xeroId === snapshot.xero_id) {
        lines.filter(line => line.source === 'so' && String(line.documentId) === snapshot.reference_id).forEach(line => { line.invoiceStatus = live.status; });
      }
    }
  }
  return { lines, movements, allocations };
}