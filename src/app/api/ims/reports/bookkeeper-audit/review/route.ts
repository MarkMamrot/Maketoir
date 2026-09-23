import { NextResponse } from 'next/server';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminSession } from '@/lib/sessionUtils';
import { acceptAuditFinding, undoAuditFindingAcceptance } from '@/lib/ims/bookkeeperAudit/repository';
import { ignoreXeroReconciliationIssue, reopenIgnoredXeroReconciliationIssue } from '@/lib/xero/reconciliation/repository';

export async function POST(request: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  if (!['Admin', 'SuperAdmin', 'Advisor'].includes(user.tier)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const action = body.action === 'accept' || body.action === 'undo' ? body.action : null;
  const findingKey = typeof body.findingKey === 'string' ? body.findingKey.trim() : '';
  const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint.trim().toLowerCase() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!action || !findingKey || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    return NextResponse.json({ error: 'A valid action, finding key, and fingerprint are required.' }, { status: 400 });
  }
  if (action === 'accept' && !reason) {
    return NextResponse.json({ error: 'A reason is required to accept an exception.' }, { status: 400 });
  }

  try {
    const xeroMatch = /^xero:(\d+)$/.exec(findingKey);
    if (xeroMatch) {
      const issueId = Number(xeroMatch[1]);
      const changed = action === 'accept'
        ? await ignoreXeroReconciliationIssue({
          businessId: user.businessId, issueId, expectedFingerprint: fingerprint, reason,
          actorId: user.userId, actorName: user.name,
        })
        : await reopenIgnoredXeroReconciliationIssue({
          businessId: user.businessId, issueId, expectedFingerprint: fingerprint,
          actorId: user.userId, actorName: user.name,
        });
      if (!changed) {
        return NextResponse.json({ error: 'The Xero finding changed or is no longer in the expected state. Refresh and review it again.' }, { status: 409 });
      }
    } else if (action === 'accept') {
      await acceptAuditFinding({
        businessId: user.businessId, findingKey, fingerprint, reason,
        actorId: user.userId, actorName: user.name,
      });
    } else {
      const undone = await undoAuditFindingAcceptance({
        businessId: user.businessId, findingKey, fingerprint,
        actorId: user.userId, actorName: user.name,
      });
      if (!undone) return NextResponse.json({ error: 'The accepted exception was not found.' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: user.businessId,
      source: 'ims_bookkeeper_audit',
      operation: action === 'accept' ? 'accept_exception' : 'undo_exception',
      title: 'Bookkeeper Audit review could not be saved',
      error,
      reference: { type: 'bookkeeper_audit_finding', id: findingKey },
    }).catch(() => {});
    return NextResponse.json({ error: 'The audit review could not be saved.' }, { status: 500 });
  }
}