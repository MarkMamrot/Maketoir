import { calculateReorderSuggestion } from '@/lib/ims/orderPlanner';
import { imsQuery } from '@/services/IMSMySQLService';

const SALES_COLUMNS = {
  7: 'sales_qty_7d',
  90: 'sales_qty_90d',
  180: 'sales_qty_180d',
  365: 'sales_qty_12m',
} as const;

export type ReorderSalesWindow = keyof typeof SALES_COLUMNS;
export type ReorderFilterType = 'supplier' | 'brand';
export type PurchaseOrderAgingMode = 'all' | 'overdue' | 'due_soon';

export interface ReorderForecastInput {
  businessId: string;
  filterType: ReorderFilterType;
  filterValue: string;
  salesWindowDays: ReorderSalesWindow;
  orderFrequencyDays: number;
  limit?: number;
  now?: number;
}

export async function loadReorderForecast(input: ReorderForecastInput) {
  const salesColumn = SALES_COLUMNS[input.salesWindowDays];
  const filterSql = input.filterType === 'supplier'
    ? "LOWER(COALESCE(NULLIF(c.company, ''), c.name, '')) LIKE ?"
    : "LOWER(COALESCE(p.brand, '')) LIKE ?";
  const rows = await imsQuery<any>(
    `SELECT p.product_id, p.name AS product_name, p.brand,
            v.variant_id, v.sku, v.pack_size, v.cost_aud,
            p.created_at, p.supplier_contact_id,
            COALESCE(NULLIF(c.company, ''), c.name, 'Unassigned') AS supplier_name,
            COALESCE(c.lead_time_days, 0) AS lead_time_days,
            COALESCE(sc.global_soh, 0) AS total_soh,
            COALESCE(sc.global_available, 0) AS total_available,
            COALESCE(sc.global_incoming, 0) AS total_incoming,
            COALESCE(sc.${salesColumn}, 0) AS sales_quantity
       FROM ims_product_variants v
       JOIN ims_products p
         ON p.product_id = v.product_id AND p.business_id = ? AND p.is_active = 1
       LEFT JOIN ims_contacts c
         ON c.id = p.supplier_contact_id AND c.business_id = ? AND c.is_active = 1
       LEFT JOIN ims_sales_cache sc ON sc.variant_id = v.variant_id
      WHERE v.business_id = ? AND v.is_active = 1 AND ${filterSql}
      ORDER BY p.name, v.sku
      LIMIT 500`,
    [input.businessId, input.businessId, input.businessId, `%${input.filterValue.toLocaleLowerCase('en-AU')}%`],
  );

  const suggestions = rows.map(row => {
    const salesQuantity = Number(row.sales_quantity ?? 0);
    const availableQuantity = Number(row.total_available ?? 0);
    const incomingQuantity = Number(row.total_incoming ?? 0);
    const suggestion = calculateReorderSuggestion({
      salesQuantity,
      salesWindowDays: input.salesWindowDays,
      createdDate: row.created_at,
      supplierLeadTimeDays: Number(row.lead_time_days ?? 0),
      orderFrequencyDays: input.orderFrequencyDays,
      availableQuantity,
      incomingQuantity,
      packSize: Number(row.pack_size ?? 0),
      now: input.now,
    });
    const unitCost = Number(row.cost_aud ?? 0);
    return {
      productId: row.product_id,
      variantId: row.variant_id,
      product: row.product_name,
      sku: row.sku ?? null,
      brand: row.brand ?? null,
      supplierId: row.supplier_contact_id == null ? null : Number(row.supplier_contact_id),
      supplier: row.supplier_name,
      salesQuantity,
      stockOnHand: Number(row.total_soh ?? 0),
      availableQuantity,
      incomingQuantity,
      supplierLeadTimeDays: Number(row.lead_time_days ?? 0),
      averageDailySales: suggestion.averageDailySales,
      coverageDays: suggestion.coverageDays,
      suggestedQuantity: suggestion.suggestedQuantity,
      packSize: Number(row.pack_size ?? 0),
      reorderQuantity: suggestion.reorderQuantity,
      unitCostExTaxAud: unitCost,
      estimatedValueExTaxAud: Math.round(suggestion.reorderQuantity * unitCost * 100) / 100,
    };
  }).filter(row => row.reorderQuantity > 0)
    .sort((a, b) => b.estimatedValueExTaxAud - a.estimatedValueExTaxAud || b.reorderQuantity - a.reorderQuantity);
  const limit = Math.min(30, Math.max(1, input.limit ?? 30));

  return {
    rows: suggestions.slice(0, limit),
    totalMatchingSuggestions: suggestions.length,
    truncated: suggestions.length > limit || rows.length >= 500,
  };
}

export interface PurchaseOrderAgingInput {
  businessId: string;
  mode: PurchaseOrderAgingMode;
  supplierSearch?: string;
  dueSoonDays: number;
  limit?: number;
}

export async function loadPurchaseOrderAging(input: PurchaseOrderAgingInput) {
  const conditions = [
    'po.business_id = ?',
    "po.status IN ('confirmed', 'partially_received', 'backordered')",
  ];
  const params: unknown[] = [input.businessId];
  if (input.mode === 'overdue') conditions.push('po.expected_date IS NOT NULL AND po.expected_date < CURDATE()');
  if (input.mode === 'due_soon') {
    conditions.push('po.expected_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)');
    params.push(input.dueSoonDays);
  }
  if (input.supplierSearch) {
    conditions.push("LOWER(COALESCE(NULLIF(c.company, ''), c.name, po.supplier_name_raw, '')) LIKE ?");
    params.push(`%${input.supplierSearch.toLocaleLowerCase('en-AU')}%`);
  }
  const limit = Math.min(50, Math.max(1, input.limit ?? 30));
  params.push(limit + 1);

  const rows = await imsQuery<any>(
    `SELECT po.id, po.po_number, po.status, po.order_date, po.expected_date,
            po.currency_code, po.exchange_rate,
            COALESCE(NULLIF(c.company, ''), c.name, po.supplier_name_raw, 'Unknown supplier') AS supplier_name,
            l.id AS location_id, l.name AS location_name,
            SUM(GREATEST(poi.qty_ordered - poi.qty_received, 0)) AS outstanding_quantity,
            SUM(GREATEST(poi.qty_ordered - poi.qty_received, 0) * poi.unit_cost * (1 - poi.discount_pct / 100)) AS outstanding_value_ex_tax,
            DATEDIFF(CURDATE(), po.order_date) AS age_days,
            CASE WHEN po.expected_date IS NULL THEN NULL ELSE DATEDIFF(CURDATE(), po.expected_date) END AS days_overdue
       FROM ims_purchase_orders po
       JOIN ims_purchase_order_items poi
         ON poi.po_id = po.id AND poi.business_id = ?
       JOIN ims_locations l
         ON l.id = po.location_id AND l.business_id = ? AND l.is_active = 1
       LEFT JOIN ims_contacts c
         ON c.id = po.supplier_id AND c.business_id = ?
      WHERE ${conditions.join(' AND ')}
      GROUP BY po.id, po.po_number, po.status, po.order_date, po.expected_date,
               po.currency_code, po.exchange_rate, supplier_name, l.id, l.name
      HAVING outstanding_quantity > 0
      ORDER BY (days_overdue IS NULL) ASC, days_overdue DESC, po.order_date ASC
      LIMIT ?`,
    [input.businessId, input.businessId, input.businessId, ...params],
  );

  return {
    rows: rows.slice(0, limit).map(row => ({
      purchaseOrderId: Number(row.id),
      purchaseOrder: row.po_number,
      status: row.status,
      supplier: row.supplier_name,
      locationId: Number(row.location_id),
      location: row.location_name,
      orderDate: row.order_date,
      expectedDate: row.expected_date ?? null,
      ageDays: Number(row.age_days ?? 0),
      daysOverdue: row.days_overdue == null ? null : Number(row.days_overdue),
      outstandingQuantity: Number(row.outstanding_quantity ?? 0),
      outstandingValueExTax: Number(row.outstanding_value_ex_tax ?? 0),
      currency: row.currency_code ?? 'AUD',
      exchangeRate: Number(row.exchange_rate ?? 1),
    })),
    truncated: rows.length > limit,
  };
}
