import { NextRequest, NextResponse } from 'next/server';
import { getImportSession } from '@/app/api/ims/import/_helpers';
import { ImsStocktakeRepo } from '@/lib/ims/ImsRepository';
import { getInventoryDocumentActivityHistory } from '@/lib/ims/inventoryDocumentHistory';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { StocktakeOperationConflict, transitionStocktake } from '@/lib/ims/stocktakes/stocktakeOperations';
import { hashInventoryDocumentRequest, InventoryDocumentLifecycleConflict } from '@/lib/ims/inventoryDocumentLifecycle';
import { InventoryDocumentRevisionConflict } from '@/lib/ims/creditNoteStatusCommands';
import { InventoryDocumentOperationConflict } from '@/lib/ims/inventoryDocumentOperations';

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getImportSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const id = parseInt(params.id, 10);
    const st = await ImsStocktakeRepo.get(id, session.businessId);
    if (!st) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    let activityHistory: Awaited<ReturnType<typeof getInventoryDocumentActivityHistory>> = [];
    try {
      activityHistory = await getInventoryDocumentActivityHistory(session.businessId, 'stocktake', id);
    } catch (error) {
      await reportRuntimeIssue({
        businessId: session.businessId, source: 'ims_stocktakes', operation: 'activity_history_load',
        title: 'Stocktake activity history failed to load', error, reference: { type: 'stocktake', id },
      }).catch(() => {});
    }
    return NextResponse.json({ ...st, activity_history: activityHistory });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getImportSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const id = parseInt(params.id, 10);
  try {
    const body = await req.json();

    // Update a single item's counted_qty
    if (body.action === 'update_item') {
      const { item_id, counted_qty, notes } = body;
      await ImsStocktakeRepo.updateItem(item_id, counted_qty, notes, session.businessId);
      return NextResponse.json({ ok: true });
    }

    // Change status
    if (body.action === 'change_status') {
      if (body.status === 'completed') {
        return NextResponse.json({ error: 'Use Complete & Apply Count to complete a stocktake.' }, { status: 409 });
      }
      const action = body.status === 'in_progress' ? 'start' : body.status === 'cancelled' ? 'cancel' : null;
      if (!action) return NextResponse.json({ error: 'Unsupported stocktake status transition.' }, { status: 409 });
      if (!body.operationKey) return NextResponse.json({ error: 'operationKey is required.' }, { status: 400 });
      const result = await transitionStocktake({
        businessId: session.businessId,
        stocktakeId: id,
        action,
        context: {
          operationKey: body.operationKey,
          requestHash: await hashInventoryDocumentRequest({}),
          expectedUpdatedAt: body.expectedUpdatedAt,
          actorId: session.userId,
          actorName: session.name ?? session.email,
        },
      });
      return NextResponse.json(result);
    }

    // Bulk update items (array of { item_id, counted_qty, notes })
    if (body.action === 'bulk_update_items' && Array.isArray(body.items)) {
      for (const item of body.items) {
        await ImsStocktakeRepo.updateItem(item.item_id, item.counted_qty ?? null, item.notes, session.businessId);
      }
      return NextResponse.json({ ok: true });
    }

    // Remove a single item
    if (body.action === 'remove_item') {
      await ImsStocktakeRepo.removeItem(body.item_id, session.businessId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    const conflict = e instanceof StocktakeOperationConflict
      || e instanceof InventoryDocumentLifecycleConflict
      || e instanceof InventoryDocumentRevisionConflict
      || e instanceof InventoryDocumentOperationConflict;
    if (!conflict) {
      await reportRuntimeIssue({
        businessId: session.businessId, source: 'ims_stocktakes', operation: 'update',
        title: 'Stocktake update failed', error: e, reference: { type: 'stocktake', id },
      }).catch(() => {});
    }
    return NextResponse.json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: conflict ? 409 : 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getImportSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const id = parseInt(params.id, 10);
  try {
    await ImsStocktakeRepo.delete(id, session.businessId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const conflict = e?.message === 'Only Draft stocktakes can be deleted';
    if (!conflict) {
      await reportRuntimeIssue({
        businessId: session.businessId, source: 'ims_stocktakes', operation: 'delete_draft',
        title: 'Stocktake deletion failed', error: e, reference: { type: 'stocktake', id },
      }).catch(() => {});
    }
    return NextResponse.json({ error: e.message }, { status: conflict ? 409 : 500 });
  }
}
