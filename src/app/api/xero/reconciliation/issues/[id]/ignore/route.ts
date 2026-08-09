import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';
import { ignoreXeroReconciliationIssue } from '@/lib/xero/reconciliation/repository';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  if (!['Admin', 'SuperAdmin', 'Advisor'].includes(user.tier)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const databaseId = typeof body.databaseId === 'string' ? body.databaseId : null;
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;
  const issueId = Number(params.id);
  if (!Number.isSafeInteger(issueId) || issueId <= 0) {
    return NextResponse.json({ error: 'A valid issue ID is required.' }, { status: 400 });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required to ignore this issue.' }, { status: 400 });
  }

  try {
    const ignored = await ignoreXeroReconciliationIssue({
      businessId: databaseId!, issueId, actorId: user.userId, actorName: user.name, reason,
    });
    if (!ignored) {
      return NextResponse.json({ error: 'The open reconciliation issue was not found.' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: databaseId, source: 'xero_reconciliation', operation: 'ignore_issue',
      title: 'Xero reconciliation issue could not be ignored', error,
      reference: { type: 'xero_reconciliation_issue', id: String(issueId) },
    });
    return NextResponse.json({ error: 'The reconciliation issue could not be ignored.' }, { status: 500 });
  }
}