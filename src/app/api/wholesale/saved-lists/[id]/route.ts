import { NextResponse } from 'next/server';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsExecute } from '@/services/IMSMySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid list.' }, { status: 400 });

  return runImsForBusiness(session.businessId, async () => {
    try {
      const privileged = session.memberRole === 'owner' || session.memberRole === 'admin';
      const result: any = await imsExecute(
        `DELETE FROM ims_wholesale_saved_lists
          WHERE id = ? AND business_id = ? AND company_id = ?
            ${privileged ? '' : 'AND created_by_member_id = ?'}`,
        privileged
          ? [id, session.businessId, session.companyId]
          : [id, session.businessId, session.companyId, session.memberId],
      );
      if (!result.affectedRows) return NextResponse.json({ error: 'Saved order not found.' }, { status: 404 });
      return NextResponse.json({ success: true });
    } catch (error) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'wholesale_portal',
        operation: 'delete_saved_order',
        title: 'Wholesale saved order could not be deleted',
        error,
        reference: { type: 'wholesale_saved_list', id },
      }).catch(() => {});
      return NextResponse.json({ success: false, error: 'The saved order could not be deleted.' }, { status: 500 });
    }
  });
}