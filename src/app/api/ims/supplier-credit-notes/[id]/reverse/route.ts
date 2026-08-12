import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSupplierCNRepo } from '@/lib/ims/ImsRepository';
import { InventoryDocumentRevisionConflict } from '@/lib/ims/creditNoteStatusCommands';
import { CreditNoteReversalConflict } from '@/lib/ims/creditNotes/creditNoteCorrections';
import { executeCreditNoteReversalWorkflow } from '@/lib/ims/creditNotes/creditNoteReversalWorkflow';
import { hashInventoryDocumentRequest, InventoryDocumentLifecycleConflict } from '@/lib/ims/inventoryDocumentLifecycle';
import { InventoryDocumentOperationConflict } from '@/lib/ims/inventoryDocumentOperations';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  const documentId = Number(params.id);
  try {
    const body = await request.json().catch(() => null);
    const reason = String(body?.reason ?? '').trim();
    if (!body?.operationKey) return NextResponse.json({ success: false, error: 'operationKey is required.' }, { status: 400 });
    if (!reason) return NextResponse.json({ success: false, error: 'A reversal reason is required.' }, { status: 400 });
    const result = await executeCreditNoteReversalWorkflow({
      kind: 'supplier_credit_note',
      businessId,
      documentId,
      reason,
      context: {
        operationKey: body.operationKey,
        requestHash: await hashInventoryDocumentRequest({ reason }),
        expectedUpdatedAt: body.expectedUpdatedAt,
        actorId: session.userId,
        actorName: session.name ?? session.email,
      },
    });
    return NextResponse.json({ success: true, data: await ImsSupplierCNRepo.get(documentId, businessId), result, xeroWarning: result.xeroWarning });
  } catch (error: any) {
    const conflict = error instanceof CreditNoteReversalConflict
      || error instanceof InventoryDocumentLifecycleConflict
      || error instanceof InventoryDocumentOperationConflict
      || error instanceof InventoryDocumentRevisionConflict;
    if (!conflict) {
      await reportRuntimeIssue({
        businessId,
        source: 'ims_supplier_credit_notes',
        operation: 'reverse_mistaken_completion',
        title: 'Supplier credit note reversal failed',
        error,
        reference: { type: 'supplier_credit_note', id: documentId },
      }).catch(() => {});
    }
    return NextResponse.json({ success: false, error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: conflict ? 409 : 500 });
  }
}