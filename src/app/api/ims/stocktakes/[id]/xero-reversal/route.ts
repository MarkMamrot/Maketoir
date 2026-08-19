import { NextResponse } from 'next/server';

import { getImportSession } from '@/app/api/ims/import/_helpers';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { assertXeroWorkflowEnabled, isXeroPolicyDisabledError } from '@/lib/xero/postingPolicy';
import { syncStocktakeReversalJournal } from '@/services/XeroSyncService';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await getImportSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const id = Number(params.id);
  try {
    await assertXeroWorkflowEnabled(session.businessId, 'stocktakeJournalEnabled');
    const result = await syncStocktakeReversalJournal(session.businessId, id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    if (isXeroPolicyDisabledError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const expectedConflict = String(error?.message ?? '').includes('not confirmed')
      || String(error?.message ?? '').includes('must be reverted');
    if (!expectedConflict) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'ims_stocktakes',
        operation: 'retry_xero_reversal_journal',
        title: 'Stocktake Xero correction retry failed',
        error,
        reference: { type: 'stocktake', id },
      }).catch(() => {});
    }
    return NextResponse.json({ error: error?.message ?? 'Xero correction retry failed.' }, { status: expectedConflict ? 409 : 500 });
  }
}
