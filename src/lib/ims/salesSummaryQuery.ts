import { attachedCogsMetrics } from '@/lib/ims/salesSummary';
import { getIMSPool } from '@/services/IMSMySQLService';

export const SALES_SUMMARY_MOVEMENT_COSTS = `
  SELECT reference_type, reference_id, variant_id,
         SUM(CASE WHEN unit_cost > 0 THEN -qty_change * unit_cost ELSE 0 END) AS attached_cogs,
         SUM(CASE WHEN unit_cost > 0 THEN ABS(qty_change) ELSE 0 END) AS covered_qty,
         SUM(CASE WHEN unit_cost IS NULL OR unit_cost <= 0 THEN 1 ELSE 0 END) AS missing_cost_count
    FROM ims_stock_movements
   WHERE movement_type IN ('pos_sale', 'so_fulfilled')
   GROUP BY reference_type, reference_id, variant_id`;

export const SALES_SUMMARY_LINES = `
  SELECT COALESCE(hvid.variant_id, hsku.variant_id, hopt.variant_id) AS variant_id,
         hl.id AS location_id, h.invoice_date AS sale_date, NULL AS sale_hour,
         h.qty AS qty, h.line_total AS amount,
         NULL AS attached_cogs, 0 AS covered_qty, 0 AS covered_amount
    FROM ims_sales_history h
    LEFT JOIN ims_product_variants hvid ON hvid.variant_id = h.variant_id
    LEFT JOIN ims_product_variants hsku ON hvid.variant_id IS NULL AND hsku.sku = h.sku
    LEFT JOIN ims_product_variants hopt ON hvid.variant_id IS NULL AND hsku.variant_id IS NULL AND hopt.cin7_option_id = h.cin7_option_id
    LEFT JOIN ims_locations hl ON hl.cin7_branch_id = h.branch_id
   WHERE h.invoice_date BETWEEN ? AND ?

  UNION ALL

  SELECT pos.variant_id, pos.location_id, pos.sale_date, pos.sale_hour,
         pos.qty, pos.amount,
         CASE WHEN mc.missing_cost_count = 0 AND ABS(mc.covered_qty - ABS(pos.qty)) < 0.0001 THEN mc.attached_cogs ELSE NULL END AS attached_cogs,
         CASE WHEN mc.missing_cost_count = 0 AND ABS(mc.covered_qty - ABS(pos.qty)) < 0.0001 THEN ABS(pos.qty) ELSE 0 END AS covered_qty,
         CASE WHEN mc.missing_cost_count = 0 AND ABS(mc.covered_qty - ABS(pos.qty)) < 0.0001 THEN pos.amount ELSE 0 END AS covered_amount
    FROM (
      SELECT ps.id AS sale_id, COALESCE(pvid.variant_id, psku.variant_id) AS variant_id,
             ps.location_id, DATE(ps.completed_at) AS sale_date, HOUR(ps.completed_at) AS sale_hour,
             SUM(psi.qty) AS qty, SUM(psi.line_total) AS amount
        FROM pos_sale_items psi
        JOIN pos_sales ps ON ps.id = psi.sale_id
        LEFT JOIN ims_product_variants pvid ON pvid.variant_id = psi.variant_id
        LEFT JOIN ims_product_variants psku ON pvid.variant_id IS NULL AND psku.sku = psi.code
       WHERE ps.status = 'completed' AND ps.sale_type = 'sale' AND ps.is_historical = 0
         AND DATE(ps.completed_at) BETWEEN ? AND ?
       GROUP BY ps.id, COALESCE(pvid.variant_id, psku.variant_id), ps.location_id,
                DATE(ps.completed_at), HOUR(ps.completed_at)
    ) pos
    LEFT JOIN (${SALES_SUMMARY_MOVEMENT_COSTS}) mc
      ON mc.reference_type = 'pos_sale' AND mc.reference_id = pos.sale_id AND mc.variant_id = pos.variant_id

  UNION ALL

  SELECT sales_order.variant_id, sales_order.location_id, sales_order.sale_date, sales_order.sale_hour,
         sales_order.qty, sales_order.amount,
         CASE WHEN mc.missing_cost_count = 0 AND ABS(mc.covered_qty - ABS(sales_order.qty)) < 0.0001 THEN mc.attached_cogs ELSE NULL END AS attached_cogs,
         CASE WHEN mc.missing_cost_count = 0 AND ABS(mc.covered_qty - ABS(sales_order.qty)) < 0.0001 THEN ABS(sales_order.qty) ELSE 0 END AS covered_qty,
         CASE WHEN mc.missing_cost_count = 0 AND ABS(mc.covered_qty - ABS(sales_order.qty)) < 0.0001 THEN sales_order.amount ELSE 0 END AS covered_amount
    FROM (
      SELECT so.id AS sale_id, COALESCE(svid.variant_id, ssku.variant_id) AS variant_id,
             so.location_id, so.order_date AS sale_date, HOUR(so.created_at) AS sale_hour,
             SUM(soi.qty_ordered) AS qty, SUM(soi.line_total) AS amount
        FROM ims_sales_order_items soi
        JOIN ims_sales_orders so ON so.id = soi.so_id
        LEFT JOIN ims_product_variants svid ON svid.variant_id = soi.variant_id
        LEFT JOIN ims_product_variants ssku ON svid.variant_id IS NULL AND ssku.sku = soi.code
       WHERE so.status NOT IN ('draft', 'cancelled') AND so.is_staff_preview_test = 0 AND so.cin7_order_id IS NULL
         AND so.order_date BETWEEN ? AND ?
       GROUP BY so.id, COALESCE(svid.variant_id, ssku.variant_id), so.location_id,
                so.order_date, HOUR(so.created_at)
    ) sales_order
    LEFT JOIN (${SALES_SUMMARY_MOVEMENT_COSTS}) mc
      ON mc.reference_type = 'sales_order' AND mc.reference_id = sales_order.sale_id AND mc.variant_id = sales_order.variant_id`;

export interface AssistantSalesPerformanceInput {
  businessId: string;
  fromDate: string;
  toDate: string;
  locationIds?: number[];
}

export async function loadAssistantSalesPerformance(input: AssistantSalesPerformanceInput) {
  const pool = getIMSPool();
  const [locationRows] = await pool.query<any>(
    'SELECT id, name FROM ims_locations WHERE business_id = ? AND is_active = 1 ORDER BY name',
    [input.businessId],
  ) as any;
  const activeIds = new Set(locationRows.map((row: any) => Number(row.id)));
  const selectedIds = input.locationIds?.length
    ? [...new Set(input.locationIds)].filter(id => activeIds.has(id))
    : [...activeIds];
  if (selectedIds.length === 0) return { rows: [], totals: null };

  const placeholders = selectedIds.map(() => '?').join(',');
  const dateParams = [input.fromDate, input.toDate, input.fromDate, input.toDate, input.fromDate, input.toDate];
  const [rows] = await pool.query<any>(
    `SELECT l.id AS location_id, l.name AS location_name,
            SUM(s.qty) AS sales_qty,
            SUM(s.amount) AS sales_amount,
            SUM(COALESCE(s.attached_cogs, 0)) AS attached_cogs,
            SUM(s.covered_qty) AS covered_qty,
            SUM(s.covered_amount) AS covered_amount
       FROM (${SALES_SUMMARY_LINES}) s
       JOIN ims_product_variants v ON v.variant_id = s.variant_id
       JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = ?
       JOIN ims_locations l ON l.id = s.location_id AND l.business_id = ?
      WHERE s.location_id IN (${placeholders})
      GROUP BY l.id, l.name
      ORDER BY sales_amount DESC, l.name`,
    [...dateParams, input.businessId, input.businessId, ...selectedIds],
  ) as any;

  const shaped = rows.map((row: any) => {
    const salesAmount = Number(row.sales_amount ?? 0);
    const coveredAmount = Number(row.covered_amount ?? 0);
    const attachedCogs = Number(row.attached_cogs ?? 0);
    return {
      locationId: Number(row.location_id),
      location: row.location_name,
      salesQuantity: Number(row.sales_qty ?? 0),
      salesAmountTaxInclusive: salesAmount,
      coveredSalesAmountTaxInclusive: coveredAmount,
      attachedCogs,
      ...attachedCogsMetrics({ salesAmountIncTax: salesAmount, coveredSalesAmountIncTax: coveredAmount, attachedCogs }),
    };
  });
  const totalsBase = shaped.reduce((total: any, row: any) => ({
    salesQuantity: total.salesQuantity + row.salesQuantity,
    salesAmountTaxInclusive: total.salesAmountTaxInclusive + row.salesAmountTaxInclusive,
    coveredSalesAmountTaxInclusive: total.coveredSalesAmountTaxInclusive + row.coveredSalesAmountTaxInclusive,
    attachedCogs: total.attachedCogs + row.attachedCogs,
  }), { salesQuantity: 0, salesAmountTaxInclusive: 0, coveredSalesAmountTaxInclusive: 0, attachedCogs: 0 });
  const totals = {
    ...totalsBase,
    ...attachedCogsMetrics({
      salesAmountIncTax: totalsBase.salesAmountTaxInclusive,
      coveredSalesAmountIncTax: totalsBase.coveredSalesAmountTaxInclusive,
      attachedCogs: totalsBase.attachedCogs,
    }),
  };
  return { rows: shaped, totals };
}
