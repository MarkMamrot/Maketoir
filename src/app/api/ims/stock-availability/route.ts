import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { summarizeStockAvailabilityRow, type StockAvailabilityIssue } from '@/lib/ims/stockAvailabilityWorkbench';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

type AvailabilityRow = {
  so_id: number;
  so_item_id: number;
  so_number: string;
  status: string;
  customer_name: string;
  location_id: number;
  location_name: string;
  expected_date: string | null;
  created_at: string;
  variant_id: string;
  sku: string | null;
  product_name: string;
  variant_label: string | null;
  qty_ordered: number | string;
  qty_fulfilled: number | string;
  qty_on_hand: number | string;
  qty_committed: number | string;
  qty_incoming: number | string;
  qty_allocated: number | string | null;
  qty_received_assigned: number | string | null;
  allocation_qty_fulfilled: number | string | null;
  allocation_count: number | string | null;
  at_risk_count: number | string | null;
  earliest_incoming_date: string | null;
  supplier_names: string | null;
};

const ISSUE_KEYS: StockAvailabilityIssue[] = ['at_risk', 'overdue', 'unsourced', 'ready', 'incoming', 'held'];

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId);

  try {
    const rows = await imsQuery<AvailabilityRow>(
      `SELECT so.id AS so_id, soi.id AS so_item_id, so.so_number, so.status,
              COALESCE(c.name, 'Unknown customer') AS customer_name,
              so.location_id, COALESCE(l.name, 'Unknown location') AS location_name,
              so.expected_date, so.created_at, soi.variant_id, v.sku,
              COALESCE(p.name, 'Unknown product') AS product_name,
              CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant_label,
              soi.qty_ordered, soi.qty_fulfilled,
              COALESCE(st.qty_on_hand, 0) AS qty_on_hand,
              COALESCE(st.qty_committed, 0) AS qty_committed,
              COALESCE(st.qty_incoming, 0) AS qty_incoming,
              COALESCE(a.qty_allocated, 0) AS qty_allocated,
              COALESCE(a.qty_received_assigned, 0) AS qty_received_assigned,
              COALESCE(a.allocation_qty_fulfilled, 0) AS allocation_qty_fulfilled,
              COALESCE(a.allocation_count, 0) AS allocation_count,
              COALESCE(a.at_risk_count, 0) AS at_risk_count,
              a.earliest_incoming_date, a.supplier_names
         FROM ims_sales_order_items soi
         JOIN ims_sales_orders so ON so.id = soi.so_id AND so.business_id = ?
         LEFT JOIN ims_contacts c ON c.id = so.customer_id
         LEFT JOIN ims_locations l ON l.id = so.location_id
         LEFT JOIN ims_product_variants v ON v.variant_id = soi.variant_id
         LEFT JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = ?
         LEFT JOIN ims_stock st ON st.variant_id = soi.variant_id AND st.location_id = so.location_id
         LEFT JOIN (
           SELECT so_item_id,
                  SUM(qty_allocated) AS qty_allocated,
                  SUM(qty_received_assigned) AS qty_received_assigned,
                  SUM(qty_fulfilled) AS allocation_qty_fulfilled,
                  COUNT(*) AS allocation_count,
                  SUM(promise_status = 'at_risk') AS at_risk_count,
                     MIN(CASE WHEN a.qty_allocated > a.qty_received_assigned THEN a.source_expected_date END) AS earliest_incoming_date,
                     GROUP_CONCAT(DISTINCT COALESCE(s.name, po.supplier_name_raw, 'Unknown supplier') ORDER BY COALESCE(s.name, po.supplier_name_raw, 'Unknown supplier') SEPARATOR ', ') AS supplier_names
                   FROM ims_stock_allocations a
                   JOIN ims_purchase_orders po ON po.id = a.po_id
                    AND po.business_id COLLATE utf8mb4_general_ci = a.business_id COLLATE utf8mb4_general_ci
                   LEFT JOIN ims_contacts s ON s.id = po.supplier_id
                  WHERE a.business_id = ? AND a.state = 'active'
                  GROUP BY a.so_item_id
         ) a ON a.so_item_id = soi.id
        WHERE soi.business_id = ?
          AND so.status IN ('confirmed','partially_fulfilled','backordered')
          AND so.is_historical = 0
          AND COALESCE(p.is_stock_item, 1) = 1
          AND soi.qty_ordered > soi.qty_fulfilled
        ORDER BY (COALESCE(a.at_risk_count, 0) > 0) DESC,
                 (COALESCE(a.qty_allocated, 0) - COALESCE(a.allocation_qty_fulfilled, 0) < soi.qty_ordered - soi.qty_fulfilled) DESC,
                 COALESCE(a.earliest_incoming_date, so.expected_date) IS NULL,
                 COALESCE(a.earliest_incoming_date, so.expected_date), so.created_at, so.id, soi.id`,
      [businessId, businessId, businessId, businessId],
    );

    const data = rows.map(row => ({
      ...row,
      qty_on_hand: Number(row.qty_on_hand),
      qty_committed: Number(row.qty_committed),
      qty_incoming: Number(row.qty_incoming),
      allocation_count: Number(row.allocation_count ?? 0),
      ...summarizeStockAvailabilityRow(row),
    }));
    const counts = Object.fromEntries(ISSUE_KEYS.map(issue => [issue, data.filter(row => row.issues.includes(issue)).length]));

    return NextResponse.json({ success: true, data, summary: { total: data.length, counts } });
  } catch (error: any) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims_stock_availability',
      operation: 'load_workbench',
      title: 'Stock availability workbench could not be loaded',
      error,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message || 'Failed to load stock availability.' }, { status: 500 });
  }
}