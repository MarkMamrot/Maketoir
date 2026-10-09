import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { getXeroSyncAccessDenied } from '@/lib/xero/advisorSyncAccess';
import { assertXeroPostingEnabled, isXeroPostingDisabledError } from '@/lib/xero/postingPolicy';
import { repostCogsRun } from '@/services/XeroCogsService';

export async function POST(request: Request, { params }: { params: { runId: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const runId = Number(params.runId);
  if (!Number.isInteger(runId) || runId <= 0) return NextResponse.json({ error: 'A valid COGS run ID is required.' }, { status: 400 });

  try {
    const body = await request.json();
    const databaseId = String(body.databaseId ?? '');
    const denied = assertBusinessAccess(user, databaseId);
    if (denied) return denied;
    const syncDenied = await getXeroSyncAccessDenied(user);
    if (syncDenied) return syncDenied;
    await assertXeroPostingEnabled(databaseId);
    const result = await runImsForBusiness(databaseId, () => repostCogsRun({ businessId: databaseId, runId }));
    if (result.outcome === 'ineligible') return NextResponse.json(result, { status: 409 });
    if (result.outcome !== 'posted') {
      await reportRuntimeIssue({
        businessId: databaseId, source: 'xero', operation: 'cogs_journal_repost',
        severity: result.outcome === 'unknown' ? 'error' : undefined,
        title: result.outcome === 'unknown' ? 'Xero COGS journal update outcome is unknown' : 'Xero COGS journal update failed',
        error: new Error(result.error), context: { runId }, reference: { type: 'cogs_run', id: String(runId) },
      }).catch(() => {});
      return NextResponse.json(result, { status: result.outcome === 'unknown' ? 202 : 502 });
    }
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (isXeroPostingDisabledError(error)) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    await reportRuntimeIssue({
      source: 'xero', operation: 'cogs_journal_repost_route', title: 'Xero COGS journal update could not be processed',
      error, context: { runId }, reference: { type: 'cogs_run', id: String(runId) },
    }).catch(() => {});
    return NextResponse.json({ error: 'Unable to update the COGS journal.' }, { status: 500 });
  }
}