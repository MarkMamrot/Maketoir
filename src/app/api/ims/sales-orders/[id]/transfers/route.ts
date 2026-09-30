import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import {
  SalesOrderTransferConflict,
  transferSalesOrderItems,
} from '@/lib/ims/orderTransfers/salesOrderTransfer';
import { StockAllocationConflict } from '@/lib/ims/stockAllocation/service';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type TransferRequest = {
  destinationMode?: 'existing' | 'new';
  targetOrderId?: number;
  operationKey?: string;
  expectedSourceUpdatedAt?: string | null;
  expectedTargetUpdatedAt?: string | null;
  lines?: Array<{
    sourceItemId?: number;
    quantity?: number;
    allocatedIncomingQuantity?: number;
  }>;
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') {
    return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  }
  const sourceOrderId = Number(params.id);
  if (!Number.isInteger(sourceOrderId) || sourceOrderId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid sales order ID.' }, { status: 400 });
  }
  const businessId = String(session.businessId);
  let targetOrderId: number | null = null;

  try {
    const body = await req.json() as TransferRequest;
    const createTarget = body.destinationMode === 'new';
    targetOrderId = createTarget ? null : Number(body.targetOrderId);
    const result = await transferSalesOrderItems({
      businessId,
      sourceOrderId,
      targetOrderId,
      createTarget,
      operationKey: String(body.operationKey ?? ''),
      expectedSourceUpdatedAt: body.expectedSourceUpdatedAt ?? null,
      expectedTargetUpdatedAt: body.expectedTargetUpdatedAt ?? null,
      lines: Array.isArray(body.lines)
        ? body.lines.map(line => ({
          sourceItemId: Number(line.sourceItemId),
          quantity: Number(line.quantity),
          allocatedIncomingQuantity: Number(line.allocatedIncomingQuantity),
        }))
        : [],
      actorId: session.userId == null ? null : Number(session.userId),
      actorName: session.name ?? session.email ?? null,
    });
    if (result.variantIds.length > 0) refreshVariantCache(result.variantIds).catch(() => {});
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ success: false, error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    if (error instanceof SalesOrderTransferConflict || error instanceof StockAllocationConflict) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId,
      source: 'ims_sales_orders',
      operation: 'move_sales_order_items',
      title: 'Sales order item movement failed',
      error,
      context: { sourceOrderId, targetOrderId },
      reference: { type: 'sales_order', id: String(sourceOrderId) },
    }).catch(() => {});
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Sales order item movement failed.',
    }, { status: 500 });
  }
}