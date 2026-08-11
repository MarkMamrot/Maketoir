import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSupplierCNRepo, SupplierReturnConflict } from '@/lib/ims/ImsRepository';
import { triggerSupplierCNXeroSync } from '@/lib/ims/xeroHooks';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';


export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  const scnId = Number(params.id);
  try {
    await ImsSupplierCNRepo.complete(scnId, businessId);
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
    return NextResponse.json({ success: false, error: e.message, ...(e instanceof SupplierReturnConflict ? { code: e.code } : {}) }, { status: e instanceof SupplierReturnConflict ? 409 : 500 });
  }
}
