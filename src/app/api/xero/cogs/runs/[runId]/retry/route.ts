import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { getXeroSyncAccessDenied } from '@/lib/xero/advisorSyncAccess';
import { assertXeroPostingEnabled, isXeroPostingDisabledError } from '@/lib/xero/postingPolicy';
import { retryCogsRun } from '@/services/XeroCogsService';

export async function POST(
  request: Request,
  { params }: { params: { runId: string } },
) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const runId = Number(params.runId);
  if (!Number.isInteger(runId) || runId <= 0) {
    return NextResponse.json({ error: 'A valid COGS run ID is required.' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const databaseId = String(body.databaseId ?? '');
    const denied = assertBusinessAccess(user, databaseId);
    if (denied) return denied;
    const syncDenied = await getXeroSyncAccessDenied(user);
    if (syncDenied) return syncDenied;
    await assertXeroPostingEnabled(databaseId);

    const result = await runImsForBusiness(databaseId, () => retryCogsRun({ businessId: databaseId, runId }));
    if (result.outcome === 'ineligible' || result.outcome === 'changed') {
      return NextResponse.json(result, { status: 409 });
    }
    if (result.outcome === 'failed') {
      await reportRuntimeIssue({
        businessId: databaseId,
        source: 'xero',
        operation: 'cogs_journal_retry',
        title: 'Xero COGS journal retry failed',
        error: new Error(result.error),
        context: { runId },
        reference: { type: 'cogs_run', id: String(runId) },
      }).catch(() => {});
      return NextResponse.json(result, { status: 502 });
    }
    if (result.outcome === 'unknown') {
      await reportRuntimeIssue({
        businessId: databaseId,
        source: 'xero',
        operation: 'cogs_journal_retry_unknown',
        severity: 'error',
        title: 'Xero COGS journal retry outcome is unknown',
        error: new Error(result.error),
        context: { runId },
        reference: { type: 'cogs_run', id: String(runId) },
      }).catch(() => {});
      return NextResponse.json(result, { status: 202 });
    }
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (isXeroPostingDisabledError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await reportRuntimeIssue({
      source: 'xero',
      operation: 'cogs_journal_retry_route',
      title: 'Xero COGS journal retry could not be processed',
      error,
      context: { runId },
      reference: { type: 'cogs_run', id: String(runId) },
    }).catch(() => {});
    return NextResponse.json({ error: 'Unable to retry the COGS journal.' }, { status: 500 });
  }
}