import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery } from '@/services/IMSMySQLService';

interface BrandPerformanceDbRow {
  brand: string;
  quantity: number | string | null;
  revenue: number | string | null;
  history_revenue: number | string | null;
  pos_revenue: number | string | null;
  online_revenue: number | string | null;
  wholesale_revenue: number | string | null;
  product_count: number | string | null;
}

export interface BrandPerformanceRow {
  brand: string;
  quantity: number;
  revenue: number;
  historyRevenue: number;
  posRevenue: number;
  onlineRevenue: number;
  wholesaleRevenue: number;
  productCount: number;
}

function numberValue(value: number | string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const ImsBrandPerformanceRepository = {
  async listBrandPerformance(
    businessId: string,
    startDate: string,
    endDate: string,
    brandNames: string[],
    limit: number,
  ): Promise<BrandPerformanceRow[]> {
    return runImsForBusiness(businessId, async () => {
      const safeLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
      const normalizedBrands = brandNames.map((brand) => brand.trim().toLowerCase());
      const brandFilter = normalizedBrands.length > 0
        ? `AND LOWER(TRIM(p.brand)) IN (${normalizedBrands.map(() => '?').join(', ')})`
        : '';
      const rows = await imsQuery<BrandPerformanceDbRow>(
        `SELECT TRIM(p.brand) AS brand,
                SUM(s.qty) AS quantity,
                SUM(s.revenue) AS revenue,
                SUM(CASE WHEN s.channel = 'history' THEN s.revenue ELSE 0 END) AS history_revenue,
                SUM(CASE WHEN s.channel = 'pos' THEN s.revenue ELSE 0 END) AS pos_revenue,
                SUM(CASE WHEN s.channel = 'online' THEN s.revenue ELSE 0 END) AS online_revenue,
                SUM(CASE WHEN s.channel = 'wholesale' THEN s.revenue ELSE 0 END) AS wholesale_revenue,
                COUNT(DISTINCT p.product_id) AS product_count
         FROM (
           SELECT COALESCE(hvid.variant_id, hsku.variant_id, hopt.variant_id) AS variant_id,
                  h.qty AS qty, h.line_total AS revenue, 'history' AS channel
           FROM ims_sales_history h
           LEFT JOIN ims_product_variants hvid ON hvid.variant_id = h.variant_id
           LEFT JOIN ims_product_variants hsku ON hvid.variant_id IS NULL AND hsku.sku = h.sku
           LEFT JOIN ims_product_variants hopt ON hvid.variant_id IS NULL AND hsku.variant_id IS NULL
             AND hopt.cin7_option_id = h.cin7_option_id
           WHERE h.invoice_date BETWEEN ? AND ?

           UNION ALL

           SELECT COALESCE(pvid.variant_id, psku.variant_id) AS variant_id,
                  psi.qty AS qty, psi.line_total AS revenue, 'pos' AS channel
           FROM pos_sale_items psi
           JOIN pos_sales ps ON ps.id = psi.sale_id
           LEFT JOIN ims_product_variants pvid ON pvid.variant_id = psi.variant_id
           LEFT JOIN ims_product_variants psku ON pvid.variant_id IS NULL AND psku.sku = psi.code
           WHERE ps.status = 'completed' AND ps.sale_type = 'sale' AND ps.is_historical = 0
             AND DATE(ps.completed_at) BETWEEN ? AND ?

           UNION ALL

           SELECT COALESCE(svid.variant_id, ssku.variant_id) AS variant_id,
                  soi.qty_ordered AS qty, soi.line_total AS revenue,
                  CASE WHEN so.so_type = 'online' THEN 'online' ELSE 'wholesale' END AS channel
           FROM ims_sales_order_items soi
           JOIN ims_sales_orders so ON so.id = soi.so_id
           LEFT JOIN ims_product_variants svid ON svid.variant_id = soi.variant_id
           LEFT JOIN ims_product_variants ssku ON svid.variant_id IS NULL AND ssku.sku = soi.code
           WHERE so.status NOT IN ('draft', 'cancelled') AND so.is_staff_preview_test = 0 AND so.cin7_order_id IS NULL
             AND so.order_date BETWEEN ? AND ?
         ) s
         JOIN ims_product_variants pv ON pv.variant_id = s.variant_id
         JOIN ims_products p ON p.product_id = pv.product_id
         WHERE p.business_id = ?
           AND NULLIF(TRIM(p.brand), '') IS NOT NULL
           ${brandFilter}
         GROUP BY TRIM(p.brand)
         ORDER BY revenue DESC, quantity DESC, brand
         LIMIT ${safeLimit}`,
        [
          startDate, endDate, startDate, endDate, startDate, endDate,
          businessId, ...normalizedBrands,
        ],
      );
      return rows.map((row) => ({
        brand: row.brand,
        quantity: numberValue(row.quantity),
        revenue: numberValue(row.revenue),
        historyRevenue: numberValue(row.history_revenue),
        posRevenue: numberValue(row.pos_revenue),
        onlineRevenue: numberValue(row.online_revenue),
        wholesaleRevenue: numberValue(row.wholesale_revenue),
        productCount: numberValue(row.product_count),
      }));
    });
  },
};