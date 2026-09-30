import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import {
  previewPurchaseOrderTransfer,
  PurchaseOrderTransferPreviewConflict,
} from '@/lib/ims/orderTransfers/purchaseOrderPreview';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const sourceOrderId = Number(params.id);
  if (!Number.isInteger(sourceOrderId) || sourceOrderId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid purchase order ID.' }, { status: 400 });
  }
  const businessId = String(session.businessId);
  try {
    const data = await previewPurchaseOrderTransfer({ businessId, sourceOrderId });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof PurchaseOrderTransferPreviewConflict) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId,
      source: 'ims_purchase_orders',
      operation: 'preview_order_transfer',
      title: 'Purchase order item movement preview could not be loaded',
      error,
      reference: { type: 'purchase_order', id: String(sourceOrderId) },
    }).catch(() => {});
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Order movement preview failed.',
    }, { status: 500 });
  }
}