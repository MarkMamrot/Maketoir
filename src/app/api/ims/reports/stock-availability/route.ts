import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import {
  buildStockAvailabilityManagementReport,
  type StockAvailabilityManagementInput,
} from '@/lib/ims/stockAvailabilityManagement';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId);

  try {
    const rows = await imsQuery<StockAvailabilityManagementInput>(
      `SELECT so.id AS so_id, soi.id AS so_item_id, so.so_number,
              COALESCE(c.name, 'Unknown customer') AS customer_name,
              COALESCE(l.name, 'Unknown location') AS location_name,
              v.sku, COALESCE(p.name, 'Unknown product') AS product_name,
              soi.qty_ordered, soi.qty_fulfilled,
              CASE WHEN so.tax_treatment = 'ex_tax'
                   THEN soi.unit_price * (1 + soi.tax_rate)
                   ELSE soi.unit_price END AS unit_price,
              soi.discount_pct,
              COALESCE(a.qty_allocated_remaining, 0) AS qty_allocated_remaining,
              COALESCE(a.qty_ready, 0) AS qty_ready,
              COALESCE(a.incoming_cost, 0) AS incoming_cost,
              a.promised_date,
              COALESCE(a.overdue_count, 0) AS overdue_count,
              COALESCE(a.at_risk_count, 0) AS at_risk_count
         FROM ims_sales_order_items soi
         JOIN ims_sales_orders so ON so.id = soi.so_id AND so.business_id = ?
         LEFT JOIN ims_contacts c ON c.id = so.customer_id
         LEFT JOIN ims_locations l ON l.id = so.location_id
         LEFT JOIN ims_product_variants v ON v.variant_id = soi.variant_id
         LEFT JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = ?
         LEFT JOIN (
           SELECT a.so_item_id,
                  SUM(GREATEST(0, a.qty_allocated - a.qty_fulfilled)) AS qty_allocated_remaining,
                  SUM(GREATEST(0, LEAST(a.qty_received_assigned, a.qty_allocated) - a.qty_fulfilled)) AS qty_ready,
                  SUM(GREATEST(0, a.qty_allocated - a.qty_received_assigned)
                    * poi.unit_cost * (1 - COALESCE(poi.discount_pct, 0) / 100)
                    * COALESCE(NULLIF(po.exchange_rate, 0), 1)
                    / CASE WHEN po.tax_treatment = 'inc_tax' AND COALESCE(poi.tax_rate, 0) > 0
                           THEN 1 + poi.tax_rate ELSE 1 END) AS incoming_cost,
                  MIN(CASE WHEN a.qty_allocated > a.qty_fulfilled THEN a.promised_date END) AS promised_date,
                  SUM(a.promised_date IS NOT NULL AND a.promised_date < CURDATE()
                    AND a.qty_allocated > a.qty_fulfilled) AS overdue_count,
                  SUM(a.promise_status = 'at_risk' AND a.qty_allocated > a.qty_fulfilled) AS at_risk_count
             FROM ims_stock_allocations a
             JOIN ims_purchase_order_items poi ON poi.id = a.po_item_id
              AND poi.business_id COLLATE utf8mb4_general_ci = a.business_id COLLATE utf8mb4_general_ci
             JOIN ims_purchase_orders po ON po.id = a.po_id
              AND po.business_id COLLATE utf8mb4_general_ci = a.business_id COLLATE utf8mb4_general_ci
            WHERE a.business_id = ? AND a.state = 'active'
            GROUP BY a.so_item_id
         ) a ON a.so_item_id = soi.id
        WHERE soi.business_id = ?
          AND so.status IN ('confirmed','partially_fulfilled','backordered')
          AND so.is_historical = 0
          AND COALESCE(p.is_stock_item, 1) = 1
          AND soi.qty_ordered > soi.qty_fulfilled
        ORDER BY (COALESCE(a.overdue_count, 0) > 0) DESC,
                 (COALESCE(a.at_risk_count, 0) > 0) DESC,
                 (soi.qty_ordered - soi.qty_fulfilled - COALESCE(a.qty_allocated_remaining, 0) > 0) DESC,
                 so.expected_date IS NULL, so.expected_date, so.created_at, so.id, soi.id`,
      [businessId, businessId, businessId, businessId],
    );

    return NextResponse.json({ success: true, ...buildStockAvailabilityManagementReport(rows) });
  } catch (error: any) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims_stock_availability',
      operation: 'load_management_report',
      title: 'Stock availability management report could not be loaded',
      error,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message || 'Failed to load stock availability report.' }, { status: 500 });
  }
}