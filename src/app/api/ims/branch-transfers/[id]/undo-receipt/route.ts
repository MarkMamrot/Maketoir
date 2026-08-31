import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { BranchTransferUndoConflict, ImsBTRepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') {
    return NextResponse.json({ success: false, error: 'Advisor accounts are read-only.' }, { status: 403 });
  }

  const transferId = Number(params.id);
  if (!Number.isInteger(transferId) || transferId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid branch transfer ID.' }, { status: 400 });
  }

  const businessId = session.businessId as string;
  try {
    const transfer = await ImsBTRepo.get(transferId, businessId);
    if (!transfer) return NextResponse.json({ success: false, error: 'Branch transfer not found.' }, { status: 404 });

    await ImsBTRepo.undoReceipt(transferId, businessId);
    const variantIds = [...new Set((transfer.items ?? []).map(item => item.variant_id).filter(Boolean))];
    if (variantIds.length > 0) refreshVariantCache(variantIds).catch(() => {});

    const updated = await ImsBTRepo.get(transferId, businessId);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    if (error instanceof BranchTransferUndoConflict) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId,
      source: 'ims_branch_transfers',
      operation: 'undo_receipt',
      title: 'Branch transfer receipt could not be undone',
      error,
      reference: { type: 'branch_transfer', id: transferId },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error?.message || 'Unable to undo branch transfer receipt.' }, { status: 500 });
  }
}
