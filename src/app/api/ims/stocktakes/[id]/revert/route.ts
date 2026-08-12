import { NextRequest, NextResponse } from 'next/server';

import { getImportSession } from '@/app/api/ims/import/_helpers';
import { InventoryDocumentRevisionConflict } from '@/lib/ims/creditNoteStatusCommands';
import { hashInventoryDocumentRequest, InventoryDocumentLifecycleConflict } from '@/lib/ims/inventoryDocumentLifecycle';
import { InventoryDocumentOperationConflict } from '@/lib/ims/inventoryDocumentOperations';
import { revertStocktake, StocktakeOperationConflict } from '@/lib/ims/stocktakes/stocktakeOperations';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { syncStocktakeReversalJournal } from '@/services/XeroSyncService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getImportSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const id = parseInt(params.id, 10);
  try {
    const body = await req.json().catch(() => null);
    const reason = String(body?.reason ?? '').trim();
    if (!body?.operationKey) return NextResponse.json({ error: 'operationKey is required.' }, { status: 400 });
    if (!reason) return NextResponse.json({ error: 'A reversal reason is required.' }, { status: 400 });
    const result = await revertStocktake({
      businessId: session.businessId,
      stocktakeId: id,
      reason,
      context: {
        operationKey: body.operationKey,
        requestHash: await hashInventoryDocumentRequest({ reason }),
        expectedUpdatedAt: body.expectedUpdatedAt,
        actorId: session.userId,
        actorName: session.name ?? session.email,
      },
    });
    let xeroWarning: string | null = null;
    if (result.xeroReversalStatus === 'queued') {
      try {
        await syncStocktakeReversalJournal(session.businessId, id);
        result.xeroReversalStatus = 'synced' as typeof result.xeroReversalStatus;
      } catch (error: any) {
        xeroWarning = error?.message ?? 'The reversing Xero journal could not be posted.';
        await reportRuntimeIssue({
          businessId: session.businessId,
          source: 'ims_stocktakes',
          operation: 'xero_reversal_journal',
          title: 'Stocktake reversed locally but Xero correction failed',
          error,
          reference: { type: 'stocktake', id },
          context: { localReversalCommitted: true },
        }).catch(() => {});
      }
    }
    return NextResponse.json({ ...result, xeroWarning });
  } catch (error: any) {
    const conflict = error instanceof StocktakeOperationConflict
      || error instanceof InventoryDocumentLifecycleConflict
      || error instanceof InventoryDocumentOperationConflict
      || error instanceof InventoryDocumentRevisionConflict;
    if (!conflict) {
      await reportRuntimeIssue({
        businessId: session.businessId, source: 'ims_stocktakes', operation: 'revert_mistaken_stocktake',
        title: 'Stocktake reversal failed', error, reference: { type: 'stocktake', id },
      }).catch(() => {});
    }
    return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: conflict ? 409 : 500 });
  }
}