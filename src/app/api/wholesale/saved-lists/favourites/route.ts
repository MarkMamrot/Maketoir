import { NextResponse } from 'next/server';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { validateWholesaleOrderItems, WholesaleItemValidationError } from '@/lib/wholesale/wholesaleOrderItems';

export async function GET() {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  return runImsForBusiness(session.businessId, async () => {
    try {
      const rows = await imsQuery<{ variant_id: string }>(
        `SELECT variant_id FROM ims_wholesale_favourites
          WHERE business_id = ? AND company_id = ? AND member_id = ?
          ORDER BY created_at DESC`,
        [session.businessId, session.companyId, session.memberId],
      );
      return NextResponse.json({ success: true, variantIds: rows.map(row => row.variant_id) });
    } catch (error) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'wholesale_portal',
        operation: 'list_favourites',
        title: 'Wholesale favourites could not be loaded',
        error,
        reference: { type: 'wholesale_member', id: session.memberId },
      }).catch(() => {});
      return NextResponse.json({ success: false, error: 'Favourites could not be loaded.' }, { status: 500 });
    }
  });
}

export async function PUT(request: Request) {
  const { session, brandAccess, response } = await requireActiveWholesaleSession();
  if (response) return response;
  return runImsForBusiness(session.businessId, async () => {
    try {
      const body = await request.json();
      const variantId = typeof body.variantId === 'string' ? body.variantId.trim() : '';
      if (!variantId || variantId.length > 64 || typeof body.favourite !== 'boolean') {
        return NextResponse.json({ error: 'Invalid favourite.' }, { status: 400 });
      }
      if (body.favourite) {
        await validateWholesaleOrderItems(session.businessId, brandAccess, [{ variant_id: variantId, qty: 1 }]);
        await imsExecute(
          `INSERT IGNORE INTO ims_wholesale_favourites
             (business_id, company_id, member_id, variant_id) VALUES (?, ?, ?, ?)`,
          [session.businessId, session.companyId, session.memberId, variantId],
        );
      } else {
        await imsExecute(
          `DELETE FROM ims_wholesale_favourites
            WHERE business_id = ? AND company_id = ? AND member_id = ? AND variant_id = ?`,
          [session.businessId, session.companyId, session.memberId, variantId],
        );
      }
      return NextResponse.json({ success: true });
    } catch (error) {
      if (error instanceof WholesaleItemValidationError) {
        return NextResponse.json({ success: false, error: error.message }, { status: 409 });
      }
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'wholesale_portal',
        operation: 'update_favourite',
        title: 'Wholesale favourite could not be updated',
        error,
        reference: { type: 'wholesale_member', id: session.memberId },
      }).catch(() => {});
      return NextResponse.json({ success: false, error: 'The favourite could not be updated.' }, { status: 500 });
    }
  });
}