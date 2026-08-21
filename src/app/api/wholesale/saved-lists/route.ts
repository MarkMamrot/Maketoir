import { NextResponse } from 'next/server';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getIMSPool, imsQuery } from '@/services/IMSMySQLService';
import {
  normalizeWholesaleSavedListItems,
  normalizeWholesaleSavedListName,
  WholesaleSavedListValidationError,
} from '@/lib/wholesale/wholesaleSavedLists';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { validateWholesaleOrderItems, WholesaleItemValidationError } from '@/lib/wholesale/wholesaleOrderItems';

export async function GET() {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;

  return runImsForBusiness(session.businessId, async () => {
    try {
      const lists = await imsQuery<any>(
        `SELECT id, name, created_by_member_id, created_at, updated_at
           FROM ims_wholesale_saved_lists
          WHERE business_id = ? AND company_id = ?
          ORDER BY updated_at DESC, id DESC`,
        [session.businessId, session.companyId],
      );
      const items = lists.length === 0 ? [] : await imsQuery<any>(
        `SELECT i.list_id, i.variant_id, i.quantity
           FROM ims_wholesale_saved_list_items i
           JOIN ims_wholesale_saved_lists l ON l.id = i.list_id
          WHERE i.business_id = ? AND l.business_id = ? AND l.company_id = ?
          ORDER BY i.id`,
        [session.businessId, session.businessId, session.companyId],
      );
      const itemsByList = new Map<number, Array<{ variantId: string; quantity: number }>>();
      for (const item of items) {
        const listItems = itemsByList.get(Number(item.list_id)) ?? [];
        listItems.push({ variantId: String(item.variant_id), quantity: Number(item.quantity) });
        itemsByList.set(Number(item.list_id), listItems);
      }
      return NextResponse.json({
        success: true,
        lists: lists.map(list => ({
          id: Number(list.id),
          name: String(list.name),
          createdByMe: Number(list.created_by_member_id) === session.memberId,
          canManage: Number(list.created_by_member_id) === session.memberId || session.memberRole === 'owner' || session.memberRole === 'admin',
          createdAt: list.created_at,
          updatedAt: list.updated_at,
          items: itemsByList.get(Number(list.id)) ?? [],
        })),
      });
    } catch (error) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'wholesale_portal',
        operation: 'list_saved_orders',
        title: 'Wholesale saved orders could not be loaded',
        error,
        reference: { type: 'wholesale_company', id: session.companyId },
      }).catch(() => {});
      return NextResponse.json({ success: false, error: 'Saved orders could not be loaded.' }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  const { session, brandAccess, response } = await requireActiveWholesaleSession();
  if (response) return response;

  return runImsForBusiness(session.businessId, async () => {
    try {
      const body = await request.json();
      const name = normalizeWholesaleSavedListName(body.name);
      const items = normalizeWholesaleSavedListItems(body.items);
      if (items.length === 0) throw new WholesaleSavedListValidationError('Add at least one variant before saving a list.');
      await validateWholesaleOrderItems(
        session.businessId,
        brandAccess,
        items.map(item => ({ variant_id: item.variantId, qty: item.quantity })),
      );

      const connection = await getIMSPool().getConnection();
      try {
        await connection.beginTransaction();
        const [result]: any = await connection.execute(
          `INSERT INTO ims_wholesale_saved_lists
             (business_id, company_id, created_by_member_id, name)
           VALUES (?, ?, ?, ?)`,
          [session.businessId, session.companyId, session.memberId, name],
        );
        const placeholders = items.map(() => '(?, ?, ?, ?)').join(',');
        await connection.execute(
          `INSERT INTO ims_wholesale_saved_list_items
             (business_id, list_id, variant_id, quantity) VALUES ${placeholders}`,
          items.flatMap(item => [session.businessId, result.insertId, item.variantId, item.quantity]),
        );
        await connection.commit();
        return NextResponse.json({ success: true, id: Number(result.insertId) });
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    } catch (error: any) {
      if (error instanceof WholesaleSavedListValidationError) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
      }
      if (error instanceof WholesaleItemValidationError) {
        return NextResponse.json({ success: false, error: error.message }, { status: 409 });
      }
      if (error?.code === 'ER_DUP_ENTRY') {
        return NextResponse.json({ success: false, error: 'A saved order with that name already exists.' }, { status: 409 });
      }
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'wholesale_portal',
        operation: 'create_saved_order',
        title: 'Wholesale saved order could not be created',
        error,
        reference: { type: 'wholesale_member', id: session.memberId },
      }).catch(() => {});
      return NextResponse.json({ success: false, error: 'The saved order could not be created.' }, { status: 500 });
    }
  });
}