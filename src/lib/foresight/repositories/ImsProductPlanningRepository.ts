import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery } from '@/services/IMSMySQLService';

export interface ProductPlanningRow {
  variantId: string;
  sku: string | null;
  productName: string;
  variantLabel: string;
  brand: string | null;
  productType: string | null;
  isOnline: boolean;
  priceIncTax: number | null;
  averageCostExTax: number | null;
  salesQuantity90Days: number;
  stockOnHand: number;
  stockAvailable: number;
  stockIncoming: number;
  cacheUpdatedAt: string | null;
}

interface ProductPlanningDbRow {
  variant_id: string;
  sku: string | null;
  product_name: string;
  variant_label: string;
  brand: string | null;
  product_type: string | null;
  is_online: number;
  price_inc_tax: number | string | null;
  average_cost_ex_tax: number | string | null;
  sales_qty_90d: number | string;
  global_soh: number | string;
  global_available: number | string;
  global_incoming: number | string;
  cache_updated_at: string | null;
}

function nullableNumber(value: number | string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const ImsProductPlanningRepository = {
  async listProductPlanningRows(businessId: string, limit: number): Promise<ProductPlanningRow[]> {
    return runImsForBusiness(businessId, async () => {
      const rows = await imsQuery<ProductPlanningDbRow>(
        `SELECT v.variant_id,
                v.sku,
                p.name AS product_name,
                CONCAT_WS(' / ', NULLIF(v.option1_value, ''), NULLIF(v.option2_value, ''), NULLIF(v.option3_value, '')) AS variant_label,
                p.brand,
                p.product_type,
                p.is_online,
                v.price_rrp AS price_inc_tax,
                v.avg_cost AS average_cost_ex_tax,
                COALESCE(sc.sales_qty_90d, 0) AS sales_qty_90d,
                COALESCE(sc.global_soh, 0) AS global_soh,
                COALESCE(sc.global_available, 0) AS global_available,
                COALESCE(sc.global_incoming, 0) AS global_incoming,
                sc.updated_at AS cache_updated_at
           FROM ims_product_variants v
           JOIN ims_products p
             ON p.product_id = v.product_id
            AND p.business_id = ?
           LEFT JOIN ims_sales_cache sc ON sc.variant_id = v.variant_id
          WHERE v.business_id = ?
            AND v.is_active = 1
            AND p.is_active = 1
          ORDER BY CASE
                     WHEN COALESCE(sc.global_available, 0) > 0 AND COALESCE(sc.sales_qty_90d, 0) = 0 THEN 0
                     WHEN COALESCE(sc.sales_qty_90d, 0) > 0
                      AND (COALESCE(sc.global_available, 0) + COALESCE(sc.global_incoming, 0)) / (sc.sales_qty_90d / 90) < 30 THEN 1
                     ELSE 2
                   END,
                   COALESCE(sc.sales_qty_90d, 0) DESC,
                   COALESCE(sc.global_available, 0) DESC,
                   p.name,
                   v.sku
          LIMIT ${limit}`,
        [businessId, businessId],
      );
      return rows.map((row) => ({
        variantId: row.variant_id,
        sku: row.sku,
        productName: row.product_name,
        variantLabel: row.variant_label || 'Default',
        brand: row.brand,
        productType: row.product_type,
        isOnline: row.is_online === 1,
        priceIncTax: nullableNumber(row.price_inc_tax),
        averageCostExTax: nullableNumber(row.average_cost_ex_tax),
        salesQuantity90Days: Number(row.sales_qty_90d),
        stockOnHand: Number(row.global_soh),
        stockAvailable: Number(row.global_available),
        stockIncoming: Number(row.global_incoming),
        cacheUpdatedAt: row.cache_updated_at,
      }));
    });
  },
};