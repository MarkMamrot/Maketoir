import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsQuery } from '@/services/IMSMySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

// GET /api/ims/online-sales/open
// Returns online sales orders that are still open (draft/confirmed), with line items.
export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const businessId = session.businessId as string;

  try {
    const orders = await imsQuery<any>(
      `SELECT so.id, so.so_number, so.order_date, so.status, so.customer_id, so.location_id,
              so.subtotal, so.tax_amount, so.freight, so.discount, so.total_amount,
              c.name AS customer_name,
              l.name AS location_name
       FROM ims_sales_orders so
       LEFT JOIN ims_contacts c ON c.id = so.customer_id
       LEFT JOIN ims_locations l ON l.id = so.location_id
       WHERE so.business_id = ?
         AND so.so_type = 'online'
         AND so.status IN ('draft', 'confirmed')
       ORDER BY so.order_date DESC, so.id DESC`,
      [businessId],
    );

    if (!orders.length) return NextResponse.json({ success: true, orders: [] });

    const orderIds = orders.map((o: any) => Number(o.id));
    const items = await imsQuery<any>(
      `SELECT i.id, i.so_id, i.variant_id, i.name, i.qty_ordered, i.unit_price, i.line_total,
              COALESCE(v.sku, i.code) AS sku,
              i.code,
              COALESCE(p.name, i.name) AS product_name
       FROM ims_sales_order_items i
       LEFT JOIN ims_product_variants v ON v.variant_id = i.variant_id
       LEFT JOIN ims_products p ON p.product_id = v.product_id
       WHERE i.so_id IN (${orderIds.map(() => '?').join(',')})
       ORDER BY i.so_id ASC, i.id ASC`,
      orderIds,
    );

    const itemsByOrder = new Map<number, any[]>();
    for (const item of items) {
      const soId = Number(item.so_id);
      if (!itemsByOrder.has(soId)) itemsByOrder.set(soId, []);
      itemsByOrder.get(soId)!.push(item);
    }

    const result = orders.map((order: any) => ({
      ...order,
      items: itemsByOrder.get(Number(order.id)) ?? [],
    }));

    return NextResponse.json({ success: true, orders: result });
  } catch (e: any) {
    await reportRuntimeIssue({
      businessId,
      source: 'online-sales',
      operation: 'list_open_orders',
      title: 'Open online sales failed to load',
      error: e,
    });
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
