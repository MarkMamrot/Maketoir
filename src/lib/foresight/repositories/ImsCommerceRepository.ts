import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery } from '@/services/IMSMySQLService';
import type { CommerceChannel, DailyCommerceObservation } from '../metrics/commerceReconciliation';

interface SalesFactRow {
  metric_date: string;
  sales_inc_tax: number | string;
  sales_tax: number | string;
  sales_cogs: number | string;
  order_count: number | string;
  cost_line_count: number | string;
  missing_cost_line_count: number | string;
  captured_cost_line_count: number | string;
}

interface ReturnFactRow {
  metric_date: string;
  channel: CommerceChannel;
  returns_inc_tax: number | string;
  returns_tax: number | string;
  returned_cogs: number | string;
  return_count: number | string;
  cost_line_count: number | string;
  missing_cost_line_count: number | string;
}

function numberValue(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function costBasis(capturedLines: number, totalLines: number): DailyCommerceObservation['costBasis'] {
  if (totalLines <= 0 || capturedLines <= 0) return 'estimated';
  return capturedLines >= totalLines ? 'captured' : 'mixed';
}

function salesObservation(channel: CommerceChannel, row: SalesFactRow): DailyCommerceObservation {
  const lineCount = numberValue(row.cost_line_count);
  return {
    metricDate: String(row.metric_date).slice(0, 10),
    channel,
    salesIncTax: numberValue(row.sales_inc_tax),
    salesTax: numberValue(row.sales_tax),
    returnsIncTax: 0,
    returnsTax: 0,
    salesCogs: numberValue(row.sales_cogs),
    returnedCogs: 0,
    orderCount: numberValue(row.order_count),
    returnCount: 0,
    costLineCount: lineCount,
    missingCostLineCount: numberValue(row.missing_cost_line_count),
    costBasis: channel === 'pos'
      ? 'estimated'
      : costBasis(numberValue(row.captured_cost_line_count), lineCount),
  };
}

function emptyObservation(metricDate: string, channel: CommerceChannel): DailyCommerceObservation {
  return {
    metricDate,
    channel,
    salesIncTax: 0,
    salesTax: 0,
    returnsIncTax: 0,
    returnsTax: 0,
    salesCogs: 0,
    returnedCogs: 0,
    orderCount: 0,
    returnCount: 0,
    costLineCount: 0,
    missingCostLineCount: 0,
    costBasis: 'estimated',
  };
}

function dateKeys(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export const ImsCommerceRepository = {
  async getDailyCommerce(
    businessId: string,
    startDate: string,
    endDate: string,
  ): Promise<DailyCommerceObservation[]> {
    return runImsForBusiness(businessId, async () => {
      const [onlineRows, posRows, returnRows] = await Promise.all([
        imsQuery<SalesFactRow>(
          `SELECT DATE_FORMAT(so.order_date, '%Y-%m-%d') AS metric_date,
                  SUM(so.total_amount) AS sales_inc_tax,
                  SUM(so.tax_amount) AS sales_tax,
                  SUM(COALESCE(costs.sales_cogs, 0)) AS sales_cogs,
                  COUNT(*) AS order_count,
                  SUM(COALESCE(costs.cost_line_count, 0)) AS cost_line_count,
                  SUM(COALESCE(costs.missing_cost_line_count, 0)) AS missing_cost_line_count,
                  SUM(COALESCE(costs.captured_cost_line_count, 0)) AS captured_cost_line_count
           FROM ims_sales_orders so
           LEFT JOIN (
             SELECT soi.so_id,
                    SUM(ABS(soi.qty_ordered) * COALESCE(NULLIF(soi.unit_cost, 0), NULLIF(pv.avg_cost, 0), NULLIF(pv.cost_aud, 0), 0)) AS sales_cogs,
                    COUNT(*) AS cost_line_count,
                    SUM(CASE
                          WHEN ABS(soi.line_total) > 0
                         AND UPPER(COALESCE(pv.sku, '')) != 'SHOPIFY-MISC'
                           AND COALESCE(NULLIF(soi.unit_cost, 0), NULLIF(pv.avg_cost, 0), NULLIF(pv.cost_aud, 0), 0) = 0
                          THEN 1 ELSE 0 END) AS missing_cost_line_count,
                    SUM(CASE WHEN COALESCE(soi.unit_cost, 0) > 0 THEN 1 ELSE 0 END) AS captured_cost_line_count
             FROM ims_sales_order_items soi
             LEFT JOIN ims_product_variants pv ON pv.variant_id = soi.variant_id
             GROUP BY soi.so_id
           ) costs ON costs.so_id = so.id
           WHERE so.business_id = ?
             AND so.so_type = 'online'
             AND (so.is_historical IS NULL OR so.is_historical = 0)
             AND so.status != 'cancelled'
             AND so.order_date BETWEEN ? AND ?
           GROUP BY DATE_FORMAT(so.order_date, '%Y-%m-%d')
           ORDER BY metric_date`,
          [businessId, startDate, endDate],
        ),
        imsQuery<SalesFactRow>(
          `SELECT DATE_FORMAT(COALESCE(ps.trading_date, DATE(ps.completed_at), DATE(ps.created_at)), '%Y-%m-%d') AS metric_date,
                  SUM(ps.total) AS sales_inc_tax,
                  SUM(ps.tax_total) AS sales_tax,
                  SUM(COALESCE(costs.sales_cogs, 0)) AS sales_cogs,
                  COUNT(*) AS order_count,
                  SUM(COALESCE(costs.cost_line_count, 0)) AS cost_line_count,
                  SUM(COALESCE(costs.missing_cost_line_count, 0)) AS missing_cost_line_count,
                  0 AS captured_cost_line_count
           FROM pos_sales ps
           JOIN ims_locations location ON location.id = ps.location_id AND location.business_id = ?
           LEFT JOIN (
             SELECT item.sale_id,
                    SUM(ABS(item.qty) * COALESCE(NULLIF(pv.avg_cost, 0), NULLIF(pv.cost_aud, 0), 0)) AS sales_cogs,
                    COUNT(*) AS cost_line_count,
                    SUM(CASE
                          WHEN ABS(item.line_total) > 0
                           AND COALESCE(NULLIF(pv.avg_cost, 0), NULLIF(pv.cost_aud, 0), 0) = 0
                          THEN 1 ELSE 0 END) AS missing_cost_line_count
             FROM pos_sale_items item
             LEFT JOIN ims_product_variants pv ON pv.variant_id = item.variant_id
             GROUP BY item.sale_id
           ) costs ON costs.sale_id = ps.id
           WHERE ps.status = 'completed'
             AND ps.sale_type = 'sale'
             AND COALESCE(ps.trading_date, DATE(ps.completed_at), DATE(ps.created_at)) BETWEEN ? AND ?
           GROUP BY DATE_FORMAT(COALESCE(ps.trading_date, DATE(ps.completed_at), DATE(ps.created_at)), '%Y-%m-%d')
           ORDER BY metric_date`,
          [businessId, startDate, endDate],
        ),
        imsQuery<ReturnFactRow>(
          `SELECT DATE_FORMAT(cn.cn_date, '%Y-%m-%d') AS metric_date,
                  CASE WHEN cn.source = 'shopify' THEN 'online' ELSE 'pos' END AS channel,
                  SUM(cn.total_amount) AS returns_inc_tax,
                  SUM(cn.tax_amount) AS returns_tax,
                  SUM(COALESCE(costs.returned_cogs, 0)) AS returned_cogs,
                  COUNT(*) AS return_count,
                  SUM(COALESCE(costs.cost_line_count, 0)) AS cost_line_count,
                  SUM(COALESCE(costs.missing_cost_line_count, 0)) AS missing_cost_line_count
           FROM ims_credit_notes cn
           LEFT JOIN (
             SELECT item.cn_id,
                    SUM(CASE WHEN item.restock = 1
                      THEN ABS(item.qty) * COALESCE(NULLIF(pv.avg_cost, 0), NULLIF(pv.cost_aud, 0), 0)
                      ELSE 0 END) AS returned_cogs,
                    SUM(CASE WHEN item.restock = 1 THEN 1 ELSE 0 END) AS cost_line_count,
                    SUM(CASE
                          WHEN item.restock = 1 AND ABS(item.line_total) > 0
                         AND UPPER(COALESCE(pv.sku, '')) != 'SHOPIFY-MISC'
                           AND COALESCE(NULLIF(pv.avg_cost, 0), NULLIF(pv.cost_aud, 0), 0) = 0
                          THEN 1 ELSE 0 END) AS missing_cost_line_count
             FROM ims_credit_note_items item
             LEFT JOIN ims_product_variants pv ON pv.variant_id = item.variant_id
             GROUP BY item.cn_id
           ) costs ON costs.cn_id = cn.id
           WHERE cn.business_id = ?
             AND cn.status = 'complete'
             AND cn.source IN ('shopify', 'pos')
             AND cn.cn_date BETWEEN ? AND ?
           GROUP BY DATE_FORMAT(cn.cn_date, '%Y-%m-%d'), channel
           ORDER BY metric_date, channel`,
          [businessId, startDate, endDate],
        ),
      ]);

      const observations = new Map<string, DailyCommerceObservation>();
      for (const metricDate of dateKeys(startDate, endDate)) {
        observations.set(`${metricDate}:online`, emptyObservation(metricDate, 'online'));
        observations.set(`${metricDate}:pos`, emptyObservation(metricDate, 'pos'));
      }
      for (const row of onlineRows) {
        const item = salesObservation('online', row);
        observations.set(`${item.metricDate}:online`, item);
      }
      for (const row of posRows) {
        const item = salesObservation('pos', row);
        observations.set(`${item.metricDate}:pos`, item);
      }
      for (const row of returnRows) {
        const metricDate = String(row.metric_date).slice(0, 10);
        const key = `${metricDate}:${row.channel}`;
        const current = observations.get(key) ?? emptyObservation(metricDate, row.channel);
        const returnCostLines = numberValue(row.cost_line_count);
        current.returnsIncTax += numberValue(row.returns_inc_tax);
        current.returnsTax += numberValue(row.returns_tax);
        current.returnedCogs += numberValue(row.returned_cogs);
        current.returnCount += numberValue(row.return_count);
        current.costLineCount += returnCostLines;
        current.missingCostLineCount += numberValue(row.missing_cost_line_count);
        if (returnCostLines > 0 && current.costBasis === 'captured') current.costBasis = 'mixed';
        observations.set(key, current);
      }

      return [...observations.values()].sort((left, right) =>
        left.metricDate.localeCompare(right.metricDate) || left.channel.localeCompare(right.channel));
    });
  },
};