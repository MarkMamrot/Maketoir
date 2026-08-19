import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { syncStocktakeJournal } from '@/services/XeroSyncService';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { notifySyncFailure } from '@/lib/ims/notifySyncFailure';
import { assertXeroWorkflowEnabled, isXeroPolicyDisabledError } from '@/lib/xero/postingPolicy';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  let databaseId = '';
  let stocktakeId: number | null = null;

  try {
    const body = await req.json();
    databaseId = String(body?.databaseId ?? '');
    stocktakeId = Number(body?.stocktakeId ?? 0);
    if (!stocktakeId) return NextResponse.json({ error: 'stocktakeId required' }, { status: 400 });
    if (!databaseId)  return NextResponse.json({ error: 'databaseId required' },  { status: 400 });

    const denied = assertBusinessAccess(user, databaseId);
    if (denied) return denied;

    await assertXeroWorkflowEnabled(databaseId, 'stocktakeJournalEnabled');
    const result = await runImsForBusiness(
      databaseId,
      () => syncStocktakeJournal(databaseId, Number(stocktakeId)),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    if (isXeroPolicyDisabledError(e)) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    if (databaseId && stocktakeId) {
      await runImsForBusiness(databaseId, async () => {
        await notifySyncFailure({
          businessId: databaseId,
          source: 'xero_sync',
          title: 'Xero Sync Failed — Stocktake Journal',
          message: `Stocktake ${stocktakeId} failed to sync to Xero. ${e?.message ?? 'Unknown error'}`,
          detail: { stocktake_id: stocktakeId, error: e?.message ?? String(e) },
          dedupeKey: `xero:stocktake:${stocktakeId}`,
          dedupeMinutes: 60,
        }).catch(() => {});
      }).catch(() => {});
    }
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
