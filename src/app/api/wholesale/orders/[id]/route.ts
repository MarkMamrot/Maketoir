/**
 * GET    /api/wholesale/orders/[id]   – get a single draft order with items
 * PUT    /api/wholesale/orders/[id]   – replace items + notes on a draft
 * DELETE /api/wholesale/orders/[id]   – delete a draft order
 */
import { NextResponse } from 'next/server';
import { requireWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { enterImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';

type Ctx = { params: { id: string } };

async function findOrder(id: number, businessId: string, contactId: number) {
  const rows = await imsQuery<any>(
    `SELECT * FROM wholesale_draft_orders WHERE id = ? AND business_id = ? AND contact_id = ?`,
    [id, businessId, contactId],
  );
  return rows[0] ?? null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { session, response } = requireWholesaleSession();
  if (response) return response;
  await enterImsForBusiness(session.businessId);

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    const order = await findOrder(id, session.businessId, session.contactId);
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const items = await imsQuery<any>(
      `SELECT * FROM wholesale_draft_order_items WHERE order_id = ? ORDER BY id`,
      [id],
    );
    return NextResponse.json({ success: true, order: { ...order, items } });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const { session, response } = requireWholesaleSession();
  if (response) return response;
  await enterImsForBusiness(session.businessId);

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    const order = await findOrder(id, session.businessId, session.contactId);
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (order.status !== 'draft') return NextResponse.json({ error: 'Only draft orders can be edited.' }, { status: 400 });

    const body = await req.json();
    const notes: string = body.notes ?? order.notes ?? '';
    const items: any[] = Array.isArray(body.items) ? body.items : [];

    const subtotal = items.reduce((s: number, i: any) => s + i.qty * i.unit_price, 0);

    await imsExecute(
      `UPDATE wholesale_draft_orders SET notes = ?, subtotal = ?, total_amount = ?, updated_at = NOW() WHERE id = ?`,
      [notes, subtotal, subtotal, id],
    );
    await imsExecute(`DELETE FROM wholesale_draft_order_items WHERE order_id = ?`, [id]);

    for (const item of items) {
      const lineTotal = item.qty * item.unit_price;
      await imsExecute(
        `INSERT INTO wholesale_draft_order_items
           (order_id, variant_id, product_id, product_name, variant_label, sku, qty, unit_price, line_total, is_indent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, item.variant_id, item.product_id, item.product_name,
         item.variant_label ?? null, item.sku ?? null,
         item.qty, item.unit_price, lineTotal, item.is_indent ? 1 : 0],
      );
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { session, response } = requireWholesaleSession();
  if (response) return response;
  await enterImsForBusiness(session.businessId);

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    const order = await findOrder(id, session.businessId, session.contactId);
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (order.status === 'submitted') return NextResponse.json({ error: 'Submitted orders cannot be deleted.' }, { status: 400 });

    await imsExecute(`DELETE FROM wholesale_draft_orders WHERE id = ?`, [id]);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
