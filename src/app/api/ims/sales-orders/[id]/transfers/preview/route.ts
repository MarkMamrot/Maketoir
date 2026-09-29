import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import {
  OrderTransferPreviewConflict,
  previewSalesOrderTransfer,
} from '@/lib/ims/orderTransfers/salesOrderPreview';
import { StockAllocationConflict } from '@/lib/ims/stockAllocation/service';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const sourceOrderId = Number(params.id);
  if (!Number.isInteger(sourceOrderId) || sourceOrderId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid sales order ID.' }, { status: 400 });
  }

  try {
    const data = await previewSalesOrderTransfer({
      businessId: String(session.businessId),
      sourceOrderId,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof OrderTransferPreviewConflict || error instanceof StockAllocationConflict) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId: String(session.businessId),
      source: 'ims_sales_orders',
      operation: 'preview_order_transfer',
      title: 'Sales order item movement preview could not be loaded',
      error,
      reference: { type: 'sales_order', id: String(sourceOrderId) },
    }).catch(() => {});
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Order movement preview failed.',
    }, { status: 500 });
  }
}