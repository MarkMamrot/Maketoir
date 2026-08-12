import { NextRequest, NextResponse } from 'next/server';
import { getImportSession } from '@/app/api/ims/import/_helpers';
import { ImsStocktakeRepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { applyStocktake, StocktakeOperationConflict } from '@/lib/ims/stocktakes/stocktakeOperations';
import { InventoryDocumentRevisionConflict } from '@/lib/ims/creditNoteStatusCommands';
import { hashInventoryDocumentRequest, InventoryDocumentLifecycleConflict } from '@/lib/ims/inventoryDocumentLifecycle';
import { InventoryDocumentOperationConflict } from '@/lib/ims/inventoryDocumentOperations';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getImportSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const id = parseInt(params.id, 10);
  try {
    const body = await req.json().catch(() => null);
    if (!body?.operationKey) return NextResponse.json({ error: 'operationKey is required.' }, { status: 400 });
    const result = await applyStocktake({
      businessId: session.businessId,
      stocktakeId: id,
      context: {
        operationKey: body.operationKey,
        requestHash: await hashInventoryDocumentRequest({}),
        expectedUpdatedAt: body.expectedUpdatedAt,
        actorId: session.userId,
        actorName: session.name ?? session.email,
      },
    });

    // EVENT-DRIVEN CACHE UPDATE: Refresh for variants affected by this stocktake
    const stocktake = await ImsStocktakeRepo.get(id, session.businessId);
    if (stocktake && (stocktake.items?.length ?? 0) > 0) {
      const vids = stocktake.items!.map(i => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for Stocktake:', err));
      }
    }

    return NextResponse.json(result);
  } catch (e: any) {
    const conflict = e instanceof StocktakeOperationConflict
      || e instanceof InventoryDocumentLifecycleConflict
      || e instanceof InventoryDocumentOperationConflict
      || e instanceof InventoryDocumentRevisionConflict;
    if (!conflict) {
      await reportRuntimeIssue({
        businessId: session.businessId, source: 'ims_stocktakes', operation: 'complete_apply',
        title: 'Stocktake completion failed', error: e, reference: { type: 'stocktake', id },
      }).catch(() => {});
    }
    return NextResponse.json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: conflict ? 409 : 500 });
  }
}
