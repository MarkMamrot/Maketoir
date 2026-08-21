/**
 * GET  /api/wholesale/orders        – list draft orders for logged-in customer
 * POST /api/wholesale/orders        – create a new draft order (with items)
 */
import { NextResponse } from 'next/server';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { validateWholesaleOrderItems, WholesaleItemValidationError } from '@/lib/wholesale/wholesaleOrderItems';

export async function GET() {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  return runImsForBusiness(session.businessId, async () => {
   try {
    const orders = await imsQuery<any>(
      `SELECT o.*, COUNT(i.id) AS item_count
       FROM wholesale_draft_orders o
       LEFT JOIN wholesale_draft_order_items i ON i.order_id = o.id
       WHERE o.business_id = ? AND o.contact_id = ?
         AND o.wholesale_company_id = ? AND o.wholesale_location_id = ? AND o.wholesale_member_id = ?
       GROUP BY o.id
       ORDER BY o.updated_at DESC`,
      [session.businessId, session.contactId, session.companyId, session.locationId, session.memberId],
    );
    return NextResponse.json({ success: true, orders });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
  });
}

export async function POST(req: Request) {
  const { session, brandAccess, response } = await requireActiveWholesaleSession();
  if (response) return response;
  return runImsForBusiness(session.businessId, async () => {
   try {
    const body = await req.json();
    const notes: string = body.notes ?? '';
    const items = await validateWholesaleOrderItems(session.businessId, brandAccess, body.items);

    // Calculate totals
    const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);

    const res = await imsExecute(
      `INSERT INTO wholesale_draft_orders
         (business_id, contact_id, wholesale_company_id, wholesale_location_id, wholesale_member_id,
          status, notes, subtotal, total_amount)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [session.businessId, session.contactId, session.companyId, session.locationId, session.memberId,
        notes, subtotal, subtotal],
    );
    const orderId = (res as any).insertId as number;

    for (const item of items) {
      const lineTotal = item.qty * item.unit_price;
      await imsExecute(
        `INSERT INTO wholesale_draft_order_items
           (order_id, variant_id, product_id, product_name, variant_label, sku, qty, unit_price, line_total, is_indent, indent_qty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, item.variant_id, item.product_id, item.product_name,
         item.variant_label ?? null, item.sku ?? null,
         item.qty, item.unit_price, lineTotal, item.is_indent ? 1 : 0, Math.max(0, Number(item.indent_qty ?? 0))],
      );
    }

    return NextResponse.json({ success: true, id: orderId });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: e instanceof WholesaleItemValidationError ? 409 : 500 });
  }
  });
}
