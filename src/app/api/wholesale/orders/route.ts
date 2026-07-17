/**
 * GET  /api/wholesale/orders        – list draft orders for logged-in customer
 * POST /api/wholesale/orders        – create a new draft order (with items)
 */
import { NextResponse } from 'next/server';
import { requireWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { enterImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';

export async function GET() {
  const { session, response } = requireWholesaleSession();
  if (response) return response;
  await enterImsForBusiness(session.businessId);

  try {
    const orders = await imsQuery<any>(
      `SELECT o.*, COUNT(i.id) AS item_count
       FROM wholesale_draft_orders o
       LEFT JOIN wholesale_draft_order_items i ON i.order_id = o.id
       WHERE o.business_id = ? AND o.contact_id = ?
       GROUP BY o.id
       ORDER BY o.updated_at DESC`,
      [session.businessId, session.contactId],
    );
    return NextResponse.json({ success: true, orders });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

interface DraftItem {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_label?: string;
  sku?: string;
  qty: number;
  unit_price: number;
  is_indent?: boolean;
}

export async function POST(req: Request) {
  const { session, response } = requireWholesaleSession();
  if (response) return response;
  await enterImsForBusiness(session.businessId);

  try {
    const body = await req.json();
    const notes: string = body.notes ?? '';
    const items: DraftItem[] = Array.isArray(body.items) ? body.items : [];

    // Calculate totals
    const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);

    const res = await imsExecute(
      `INSERT INTO wholesale_draft_orders
         (business_id, contact_id, status, notes, subtotal, total_amount)
       VALUES (?, ?, 'draft', ?, ?, ?)`,
      [session.businessId, session.contactId, notes, subtotal, subtotal],
    );
    const orderId = (res as any).insertId as number;

    for (const item of items) {
      const lineTotal = item.qty * item.unit_price;
      await imsExecute(
        `INSERT INTO wholesale_draft_order_items
           (order_id, variant_id, product_id, product_name, variant_label, sku, qty, unit_price, line_total, is_indent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, item.variant_id, item.product_id, item.product_name,
         item.variant_label ?? null, item.sku ?? null,
         item.qty, item.unit_price, lineTotal, item.is_indent ? 1 : 0],
      );
    }

    return NextResponse.json({ success: true, id: orderId });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
