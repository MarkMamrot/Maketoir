import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { ImsPORepo } from '@/lib/ims/ImsRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  const poId = Number(params.id);
  try {
    const data = await ImsPORepo.getSupplierReturnContext(poId, businessId);
    if (!data) {
      return NextResponse.json({
        success: false,
        error: 'A completed purchase order was not found for this supplier return.',
      }, { status: 404 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims_purchase_orders',
      operation: 'load_supplier_return_context',
      title: 'Purchase order supplier-return context could not be loaded',
      error,
      reference: { type: 'purchase_order', id: poId },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error?.message ?? 'Supplier-return context failed' }, { status: 500 });
  }
}