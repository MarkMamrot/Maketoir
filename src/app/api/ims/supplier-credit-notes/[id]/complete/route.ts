import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSupplierCNRepo, SupplierReturnConflict } from '@/lib/ims/ImsRepository';
import { triggerSupplierCNXeroSync } from '@/lib/ims/xeroHooks';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { InventoryDocumentRevisionConflict } from '@/lib/ims/creditNoteStatusCommands';
import { hashInventoryDocumentRequest, InventoryDocumentLifecycleConflict } from '@/lib/ims/inventoryDocumentLifecycle';
import { InventoryDocumentOperationConflict } from '@/lib/ims/inventoryDocumentOperations';


export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  const scnId = Number(params.id);
  try {
    const body = await request.json().catch(() => null);
    if (!body?.operationKey) return NextResponse.json({ success: false, error: 'operationKey is required.' }, { status: 400 });
    await ImsSupplierCNRepo.complete(scnId, businessId, {
      operationKey: body.operationKey,
      requestHash: await hashInventoryDocumentRequest({}),
      expectedUpdatedAt: body.expectedUpdatedAt,
      actorId: session.userId,
      actorName: session.name ?? session.email,
    });
    triggerSupplierCNXeroSync(businessId, scnId).catch(error => reportRuntimeIssue({
      businessId,
      source: 'ims_supplier_credit_notes',
      operation: 'complete_xero_sync',
      title: 'Supplier credit note completed but Xero sync failed',
      error,
      reference: { type: 'supplier_credit_note', id: scnId },
    }).catch(() => {}));
    const scn = await ImsSupplierCNRepo.get(scnId, businessId);
    return NextResponse.json({
      success: true,
      data: scn,
      xeroSync: {
        state: 'queued',
        queuedAt: new Date().toISOString(),
        retryEligible: true,
        pollEndpoint: `/api/ims/supplier-credit-notes/${scnId}/xero-status`,
      },
    });
  } catch (e: any) {
    const conflict = e instanceof SupplierReturnConflict || e instanceof InventoryDocumentLifecycleConflict || e instanceof InventoryDocumentOperationConflict || e instanceof InventoryDocumentRevisionConflict;
    return NextResponse.json({ success: false, error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: conflict ? 409 : 500 });
  }
}
