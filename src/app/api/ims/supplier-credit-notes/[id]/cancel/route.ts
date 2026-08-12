import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSupplierCNRepo } from '@/lib/ims/ImsRepository';
import { executeCreditNoteStatusCommand, InventoryDocumentRevisionConflict } from '@/lib/ims/creditNoteStatusCommands';
import { hashInventoryDocumentRequest, InventoryDocumentLifecycleConflict } from '@/lib/ims/inventoryDocumentLifecycle';
import { InventoryDocumentOperationConflict } from '@/lib/ims/inventoryDocumentOperations';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  const scnId = Number(params.id);
  try {
    const body = await request.json();
    if (!body.operationKey) return NextResponse.json({ success: false, error: 'operationKey is required.' }, { status: 400 });
    await executeCreditNoteStatusCommand({
      businessId,
      documentKind: 'supplier_credit_note',
      documentId: scnId,
      action: 'cancel',
      context: {
        operationKey: body.operationKey,
        requestHash: await hashInventoryDocumentRequest({}),
        expectedUpdatedAt: body.expectedUpdatedAt,
        actorId: session.userId,
        actorName: session.name ?? session.email,
      },
    });
    const scn = await ImsSupplierCNRepo.get(scnId, businessId);
    return NextResponse.json({ success: true, data: scn });
  } catch (e: any) {
    const conflict = e instanceof InventoryDocumentLifecycleConflict || e instanceof InventoryDocumentOperationConflict || e instanceof InventoryDocumentRevisionConflict;
    return NextResponse.json({ success: false, error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: conflict ? 409 : 500 });
  }
}