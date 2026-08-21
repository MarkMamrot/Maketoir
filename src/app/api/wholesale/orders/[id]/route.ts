/**
 * GET    /api/wholesale/orders/[id]   – get a single draft order with items
 * PUT    /api/wholesale/orders/[id]   – replace items + notes on a draft
 * DELETE /api/wholesale/orders/[id]   – delete a draft order
 */
import { NextResponse } from 'next/server';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { validateWholesaleOrderItems, WholesaleItemValidationError } from '@/lib/wholesale/wholesaleOrderItems';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { auditWholesalePreviewDraft, previewDraftWhere, requireWholesaleDraftWriteAccess } from '@/lib/wholesale/wholesalePreviewPolicy';
import type { ActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';

type Ctx = { params: { id: string } };

async function reportDraftFailure(operation: string, session: { businessId: string; memberId: number }, id: number, error: unknown) {
  await reportRuntimeIssue({
    businessId: session.businessId,
    source: 'wholesale_portal',
    operation,
    title: 'Wholesale draft operation failed',
    error,
    context: { wholesaleDraftId: id },
    reference: { type: 'wholesale_member', id: session.memberId },
  }).catch(() => {});
}

async function findOrder(
  id: number,
  owner: ActiveWholesaleSession,
) {
  const preview = previewDraftWhere(owner);
  const rows = await imsQuery<any>(
    `SELECT * FROM wholesale_draft_orders
      WHERE id = ? AND business_id = ? AND contact_id = ?
        AND wholesale_company_id = ? AND wholesale_location_id = ? AND wholesale_member_id = ?
        ${preview.sql}`,
      [id, owner.businessId, owner.contactId, owner.companyId, owner.locationId, owner.memberId, ...preview.params],
  );
  return rows[0] ?? null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  return runImsForBusiness(session.businessId, async () => {
   try {
    const order = await findOrder(id, session);
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const items = await imsQuery<any>(
      `SELECT * FROM wholesale_draft_order_items WHERE order_id = ? ORDER BY id`,
      [id],
    );
    return NextResponse.json({ success: true, order: { ...order, items } });
  } catch (e: any) {
    await reportDraftFailure('load_draft_order', session, id, e);
    return NextResponse.json({ success: false, error: 'The draft could not be loaded.' }, { status: 500 });
  }
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  const { session, brandAccess, response } = await requireActiveWholesaleSession();
  if (response) return response;
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  return runImsForBusiness(session.businessId, async () => {
   try {
    const accessResponse = await requireWholesaleDraftWriteAccess(session);
    if (accessResponse) return accessResponse;
    const order = await findOrder(id, session);
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (order.status !== 'draft') return NextResponse.json({ error: 'Only draft orders can be edited.' }, { status: 400 });

    const body = await req.json();
    const notes: string = body.notes ?? order.notes ?? '';
    const items = await validateWholesaleOrderItems(session.businessId, brandAccess, body.items);

    const subtotal = items.reduce((s: number, i: any) => s + i.qty * i.unit_price, 0);

    await imsExecute(
      `UPDATE wholesale_draft_orders SET notes = ?, subtotal = ?, total_amount = ?, updated_at = NOW()
        WHERE id = ? AND business_id = ? AND wholesale_company_id = ? AND wholesale_location_id = ? AND wholesale_member_id = ?`,
      [notes, subtotal, subtotal, id, session.businessId, session.companyId, session.locationId, session.memberId],
    );
    await imsExecute(`DELETE FROM wholesale_draft_order_items WHERE order_id = ?`, [id]);

    for (const item of items) {
      const lineTotal = item.qty * item.unit_price;
      await imsExecute(
        `INSERT INTO wholesale_draft_order_items
           (order_id, variant_id, product_id, product_name, variant_label, sku, qty, unit_price, line_total, is_indent, indent_qty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, item.variant_id, item.product_id, item.product_name,
         item.variant_label ?? null, item.sku ?? null,
         item.qty, item.unit_price, lineTotal, item.is_indent ? 1 : 0, Math.max(0, Number(item.indent_qty ?? 0))],
      );
    }

    await auditWholesalePreviewDraft(session, 'staff_test_draft_updated', id);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof WholesaleItemValidationError) {
      return NextResponse.json({ success: false, error: e.message }, { status: 409 });
    }
    await reportDraftFailure('update_draft_order', session, id, e);
    return NextResponse.json({ success: false, error: 'The draft could not be updated.' }, { status: 500 });
  }
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  return runImsForBusiness(session.businessId, async () => {
   try {
    const accessResponse = await requireWholesaleDraftWriteAccess(session);
    if (accessResponse) return accessResponse;
    const order = await findOrder(id, session);
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (order.status === 'submitted') return NextResponse.json({ error: 'Submitted orders cannot be deleted.' }, { status: 400 });

    await imsExecute(
      `DELETE FROM wholesale_draft_orders
        WHERE id = ? AND business_id = ? AND wholesale_company_id = ? AND wholesale_location_id = ? AND wholesale_member_id = ?`,
      [id, session.businessId, session.companyId, session.locationId, session.memberId],
    );
    await auditWholesalePreviewDraft(session, 'staff_test_draft_deleted', id);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    await reportDraftFailure('delete_draft_order', session, id, e);
    return NextResponse.json({ success: false, error: 'The draft could not be deleted.' }, { status: 500 });
  }
  });
}
