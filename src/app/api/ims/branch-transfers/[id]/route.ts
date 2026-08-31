import { NextResponse } from 'next/server';
import { BranchTransferEditConflict, BranchTransferUndoConflict, ImsBTRepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

const IMS_OR_POS_SESSION = ['marketoir_session', 'pos_session'];

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession(IMS_OR_POS_SESSION);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const data = await ImsBTRepo.get(Number(params.id), session.businessId);
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession(IMS_OR_POS_SESSION);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json();
    const { items, status, receivedItems, action, item_id, ...btData } = body;
    if (action === 'undo_receipt') {
      const transferId = Number(params.id);
      const existing = await ImsBTRepo.get(transferId, session.businessId);
      if (!existing) return NextResponse.json({ success: false, error: 'Branch transfer not found.' }, { status: 404 });
      try {
        await ImsBTRepo.undoReceipt(transferId, session.businessId);
      } catch (error) {
        if (error instanceof BranchTransferUndoConflict) {
          return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: 409 });
        }
        await reportRuntimeIssue({
          businessId: session.businessId,
          source: 'ims_branch_transfers',
          operation: 'undo_receipt',
          title: 'Branch transfer receipt could not be undone',
          error,
          reference: { type: 'branch_transfer', id: transferId },
        }).catch(() => {});
        throw error;
      }
      const vids = [...new Set((existing.items ?? []).map(item => item.variant_id).filter(Boolean))] as string[];
      if (vids.length > 0) refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for BT receipt undo:', err));
      return NextResponse.json({ success: true });
    }
    if (action === 'remove_item') {
      if (!item_id) return NextResponse.json({ success: false, error: 'item_id required' }, { status: 400 });
      const existing = await ImsBTRepo.get(Number(params.id), session.businessId);
      await ImsBTRepo.removeItem(Number(params.id), Number(item_id), session.businessId);
      // Deleting a received line returns stock to source → refresh cache.
      const vids = (existing?.items ?? []).map(i => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for BT:', err));
      return NextResponse.json({ success: true });
    }
    if (action === 'set_item_received') {
      if (!item_id) return NextResponse.json({ success: false, error: 'item_id required' }, { status: 400 });
      await ImsBTRepo.setItemReceived(Number(params.id), Number(item_id), Number(body.qty_received), session.businessId);
      // Adjusting qty_received moves stock between branches → refresh cache.
      const btDataFull = await ImsBTRepo.get(Number(params.id), session.businessId);
      const vids = (btDataFull?.items ?? []).map(i => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for BT:', err));
      return NextResponse.json({ success: true });
    }
    if (status) {
      await ImsBTRepo.changeStatus(Number(params.id), status, receivedItems, session.businessId);
      
      // EVENT-DRIVEN CACHE UPDATE: Refresh for branch transfer transition
      // Though global_soh generally stays the same in BTs, transitioning to sent/received updates committed vs available stock
      const btDataFull = await ImsBTRepo.get(Number(params.id), session.businessId);
      if (btDataFull && (btDataFull.items?.length ?? 0) > 0) {
        const vids = btDataFull.items!.map(i => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for BT:', err));
        }
      }

    } else {
      const existing = await ImsBTRepo.get(Number(params.id), session.businessId);
      await ImsBTRepo.update(Number(params.id), btData, items, session.businessId);

      // EVENT-DRIVEN CACHE UPDATE
      if (items && items.length > 0) {
        const vids = [...new Set([
          ...(existing?.items ?? []).map(item => item.variant_id),
          ...items.map((item: any) => item.variant_id),
        ].filter(Boolean))] as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for BT:', err));
        }
      }
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof BranchTransferEditConflict) {
      return NextResponse.json({ success: false, error: e.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession(IMS_OR_POS_SESSION);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const existing = await ImsBTRepo.get(Number(params.id), session.businessId);
    await ImsBTRepo.delete(Number(params.id), session.businessId);

    // EVENT-DRIVEN CACHE UPDATE (Deletion reverses committed transfer stock)
    if (existing && (existing.items?.length ?? 0) > 0) {
      const vids = existing.items!.map(i => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for BT deletion:', err));
      }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
