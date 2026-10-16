import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { syncStocktakeJournal } from '@/services/XeroSyncService';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { notifySyncFailure } from '@/lib/ims/notifySyncFailure';
import { assertXeroWorkflowEnabled, isXeroPolicyDisabledError } from '@/lib/xero/postingPolicy';
import { getXeroSyncAccessDenied } from '@/lib/xero/advisorSyncAccess';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  let databaseId = '';
  let stocktakeId: number | null = null;
  let automatic = false;

  try {
    const body = await req.json();
    automatic = body?.automatic === true;
    databaseId = String(body?.databaseId ?? '');
    stocktakeId = Number(body?.stocktakeId ?? 0);
    if (!stocktakeId) return NextResponse.json({ error: 'stocktakeId required' }, { status: 400 });
    if (!databaseId)  return NextResponse.json({ error: 'databaseId required' },  { status: 400 });

    const denied = assertBusinessAccess(user, databaseId);
    if (denied) return denied;
    const syncDenied = await getXeroSyncAccessDenied(user);
    if (syncDenied) return syncDenied;

    await assertXeroWorkflowEnabled(databaseId, 'stocktakeJournalEnabled');
    const result = await runImsForBusiness(
      databaseId,
      () => syncStocktakeJournal(databaseId, Number(stocktakeId)),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    if (isXeroPolicyDisabledError(e)) {
      if (automatic) return NextResponse.json({ ok: true, skipped: true, code: e.code });
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : 'Unable to sync the stocktake journal.';
    if (databaseId && stocktakeId) {
      try {
        await runImsForBusiness(databaseId, () => notifySyncFailure({
          businessId: databaseId,
          source: 'xero_sync',
          title: 'Xero Sync Failed — Stocktake Journal',
          message: `Stocktake ${stocktakeId} failed to sync to Xero. ${message}`,
          detail: { stocktake_id: stocktakeId, error: message },
          dedupeKey: `xero:stocktake:${stocktakeId}`,
          dedupeMinutes: 60,
        }));
      } catch (notificationError) {
        await reportRuntimeIssue({
          businessId: databaseId, source: 'XeroStocktakeJournal', operation: 'notify_sync_failure',
          title: 'Unable to record the stocktake Xero failure notification',
          error: notificationError, context: { stocktake_id: stocktakeId, sync_error: message },
        });
      }
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
