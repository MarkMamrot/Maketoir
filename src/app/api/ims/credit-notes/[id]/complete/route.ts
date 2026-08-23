import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsCNRepo } from '@/lib/ims/ImsRepository';
import { triggerCNXeroSync } from '@/lib/ims/xeroHooks';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { InventoryDocumentRevisionConflict } from '@/lib/ims/creditNoteStatusCommands';
import { hashInventoryDocumentRequest, InventoryDocumentLifecycleConflict } from '@/lib/ims/inventoryDocumentLifecycle';
import { InventoryDocumentOperationConflict } from '@/lib/ims/inventoryDocumentOperations';
import { settleNativeCreditNoteRefund } from '@/lib/onlineShop/onlineShopRefunds';


export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  const cnId = Number(params.id);
  let nativeRefundAttempted = false;
  try {
    const body = await request.json().catch(() => null);
    if (!body?.operationKey) return NextResponse.json({ success: false, error: 'operationKey is required.' }, { status: 400 });
    const pendingNote = await ImsCNRepo.get(cnId, businessId);
    if (pendingNote?.so_id && pendingNote.settlement_method === 'refund') {
      nativeRefundAttempted = true;
      await settleNativeCreditNoteRefund({ businessId, creditNoteId: cnId });
    }
    await ImsCNRepo.complete(cnId, businessId, {
      operationKey: body.operationKey,
      requestHash: await hashInventoryDocumentRequest({}),
      expectedUpdatedAt: body.expectedUpdatedAt,
      actorId: session.userId,
      actorName: session.name ?? session.email,
    });
    triggerCNXeroSync(businessId, cnId).catch(error => reportRuntimeIssue({
      businessId,
      source: 'ims_credit_notes',
      operation: 'complete_xero_sync',
      title: 'Customer credit note completed but Xero sync failed',
      error,
      reference: { type: 'credit_note', id: cnId },
    }).catch(() => {}));
    const cn = await ImsCNRepo.get(cnId, businessId);
    return NextResponse.json({
      success: true,
      data: cn,
      xeroSync: {
        state: 'queued',
        queuedAt: new Date().toISOString(),
        retryEligible: true,
        pollEndpoint: `/api/ims/credit-notes/${cnId}/xero-status`,
      },
    });
  } catch (e: any) {
    if (nativeRefundAttempted) {
      await reportRuntimeIssue({
        businessId,
        source: 'online_shop_refunds',
        operation: 'settle_credit_note',
        title: 'Native online order refund could not be settled',
        error: e,
        reference: { type: 'credit_note', id: cnId },
      }).catch(() => {});
    }
    const conflict = e instanceof InventoryDocumentLifecycleConflict || e instanceof InventoryDocumentOperationConflict || e instanceof InventoryDocumentRevisionConflict;
    return NextResponse.json({ success: false, error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: conflict ? 409 : 500 });
  }
}
