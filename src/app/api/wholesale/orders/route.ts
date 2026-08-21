/**
 * GET  /api/wholesale/orders        – list drafts and submitted sales orders for the active account
 * POST /api/wholesale/orders        – create a new draft order (with items)
 */
import { NextResponse } from 'next/server';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { validateWholesaleOrderItems, WholesaleItemValidationError } from '@/lib/wholesale/wholesaleOrderItems';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { auditWholesalePreviewDraft, requireWholesaleDraftWriteAccess } from '@/lib/wholesale/wholesalePreviewPolicy';

export async function GET() {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  return runImsForBusiness(session.businessId, async () => {
   try {
    const draftPreviewSql = session.preview
      ? 'AND (o.is_staff_preview_test = 0 OR (o.is_staff_preview_test = 1 AND o.staff_preview_session_id = ?))'
      : 'AND o.is_staff_preview_test = 0';
    const draftPreviewParams = session.preview ? [session.preview.previewSessionId] : [];
    const drafts = await imsQuery<any>(
      `SELECT 'draft' AS kind, o.id, CONCAT('Draft #', o.id) AS reference, o.status,
              o.notes, o.subtotal, o.total_amount, o.created_at, o.updated_at, o.is_staff_preview_test,
              wl.id AS wholesale_location_id, wl.location_name,
              COUNT(i.id) AS item_count, COALESCE(SUM(i.qty), 0) AS total_units
       FROM wholesale_draft_orders o
       JOIN ims_wholesale_member_locations ml
         ON ml.business_id = o.business_id AND ml.company_id = o.wholesale_company_id
        AND ml.member_id = o.wholesale_member_id AND ml.location_id = o.wholesale_location_id
       JOIN ims_wholesale_company_locations wl
         ON wl.id = ml.location_id AND wl.business_id = ml.business_id
        AND wl.company_id = ml.company_id AND wl.status = 'active'
       LEFT JOIN wholesale_draft_order_items i ON i.order_id = o.id
       WHERE o.business_id = ? AND o.contact_id = ?
         AND o.wholesale_company_id = ? AND o.wholesale_member_id = ?
         AND o.status = 'draft'
         ${draftPreviewSql}
       GROUP BY o.id
       ORDER BY o.updated_at DESC`,
      [session.businessId, session.contactId, session.companyId, session.memberId, ...draftPreviewParams],
    );
    const salesOrders = await imsQuery<any>(
      `SELECT 'sales_order' AS kind, o.id, o.so_number AS reference, o.status,
              o.subtotal, o.tax_amount, o.total_amount, o.currency_code,
              o.order_date, o.expected_date, o.fulfilled_date, o.created_at, o.updated_at,
              wl.id AS wholesale_location_id, wl.location_name,
              COUNT(i.id) AS item_count, COALESCE(SUM(i.qty_ordered), 0) AS total_units,
              COALESCE(SUM(i.qty_fulfilled), 0) AS fulfilled_units
         FROM ims_sales_orders o
         JOIN ims_wholesale_member_locations ml
           ON ml.business_id = o.business_id AND ml.company_id = o.wholesale_company_id
          AND ml.member_id = o.wholesale_member_id AND ml.location_id = o.wholesale_location_id
         JOIN ims_wholesale_company_locations wl
           ON wl.id = ml.location_id AND wl.business_id = ml.business_id
          AND wl.company_id = ml.company_id AND wl.status = 'active'
         LEFT JOIN ims_sales_order_items i ON i.so_id = o.id
        WHERE o.business_id = ? AND o.customer_id = ?
          AND o.wholesale_company_id = ? AND o.wholesale_member_id = ?
          AND o.is_staff_preview_test = 0
        GROUP BY o.id
        ORDER BY o.updated_at DESC`,
      [session.businessId, session.contactId, session.companyId, session.memberId],
    );
    const orders = [...drafts, ...salesOrders].sort(
      (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
    );
    return NextResponse.json({ success: true, orders });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'wholesale_portal',
      operation: 'list_orders',
      title: 'Wholesale order history could not be loaded',
      error,
      reference: { type: 'wholesale_member', id: session.memberId },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Orders could not be loaded.' }, { status: 500 });
  }
  });
}

export async function POST(req: Request) {
  const { session, brandAccess, response } = await requireActiveWholesaleSession();
  if (response) return response;
  return runImsForBusiness(session.businessId, async () => {
   try {
    const accessResponse = await requireWholesaleDraftWriteAccess(session);
    if (accessResponse) return accessResponse;
    const body = await req.json();
    const notes: string = body.notes ?? '';
    const items = await validateWholesaleOrderItems(session.businessId, brandAccess, body.items);

    // Calculate totals
    const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);

    const res = await imsExecute(
      `INSERT INTO wholesale_draft_orders
         (business_id, contact_id, wholesale_company_id, wholesale_location_id, wholesale_member_id,
         is_staff_preview_test, staff_preview_session_id, staff_preview_actor_user_id, staff_preview_actor_name,
         status, notes, subtotal, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [session.businessId, session.contactId, session.companyId, session.locationId, session.memberId,
        session.preview ? 1 : 0, session.preview?.previewSessionId ?? null,
        session.preview?.actorUserId ?? null, session.preview?.actorName ?? null,
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

    await auditWholesalePreviewDraft(session, 'staff_test_draft_created', orderId);

    return NextResponse.json({ success: true, id: orderId });
  } catch (e: any) {
    if (e instanceof WholesaleItemValidationError) {
      return NextResponse.json({ success: false, error: e.message }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'wholesale_portal',
      operation: 'create_draft_order',
      title: 'Wholesale draft could not be created',
      error: e,
      reference: { type: 'wholesale_member', id: session.memberId },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'The draft could not be created.' }, { status: 500 });
  }
  });
}
