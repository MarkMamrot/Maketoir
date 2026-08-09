import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { scanXeroReconciliationTargets } from '@/lib/xero/reconciliation/scanner';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  if (!['Admin', 'SuperAdmin', 'Advisor'].includes(user.tier)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const databaseId = typeof body.databaseId === 'string' ? body.databaseId : null;
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;
  const afterId = Math.max(0, Math.floor(Number(body.afterId ?? 0)));
  const limit = Math.max(1, Math.min(500, Math.floor(Number(body.limit ?? 100))));
  if (!Number.isFinite(afterId) || !Number.isFinite(limit)) {
    return NextResponse.json({ error: 'afterId and limit must be valid numbers.' }, { status: 400 });
  }

  try {
    const result = await scanXeroReconciliationTargets({ businessId: databaseId!, afterId, limit });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: databaseId,
      source: 'xero_reconciliation',
      operation: 'manual_scan',
      title: 'Manual Xero reconciliation scan failed',
      error,
    });
    return NextResponse.json({ success: false, error: 'The Xero reconciliation scan could not be completed.' }, { status: 500 });
  }
}