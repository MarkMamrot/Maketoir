import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { transferSalesOrderItemsBatch } from '@/lib/ims/orderTransfers/salesOrderBatchTransfer';
import { SalesOrderTransferConflict } from '@/lib/ims/orderTransfers/salesOrderTransfer';
import { StockAllocationConflict } from '@/lib/ims/stockAllocation/service';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type BatchTransferRequest = {
  targetOrderId?: number;
  expectedTargetUpdatedAt?: string | null;
  operationKey?: string;
  sources?: Array<{
    sourceOrderId?: number;
    expectedSourceUpdatedAt?: string | null;
    lines?: Array<{
      sourceItemId?: number;
      quantity?: number;
      allocatedIncomingQuantity?: number;
    }>;
  }>;
};

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') {
    return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  }

  const businessId = String(session.businessId);
  let targetOrderId: number | null = null;
  let sourceOrderIds: number[] = [];
  try {
    const body = await req.json() as BatchTransferRequest;
    targetOrderId = Number(body.targetOrderId);
    sourceOrderIds = Array.isArray(body.sources)
      ? body.sources.map(source => Number(source.sourceOrderId))
      : [];
    const result = await transferSalesOrderItemsBatch({
      businessId,
      targetOrderId,
      expectedTargetUpdatedAt: body.expectedTargetUpdatedAt ?? null,
      operationKey: String(body.operationKey ?? ''),
      sources: Array.isArray(body.sources)
        ? body.sources.map(source => ({
          sourceOrderId: Number(source.sourceOrderId),
          expectedSourceUpdatedAt: source.expectedSourceUpdatedAt ?? null,
          lines: Array.isArray(source.lines)
            ? source.lines.map(line => ({
              sourceItemId: Number(line.sourceItemId),
              quantity: Number(line.quantity),
              allocatedIncomingQuantity: Number(line.allocatedIncomingQuantity),
            }))
            : [],
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
      operation: 'move_sales_order_items_batch',
      title: 'Sales order batch item movement failed',
      error,
      context: { targetOrderId, sourceOrderIds },
      reference: { type: 'sales_order', id: targetOrderId == null ? undefined : String(targetOrderId) },
    }).catch(() => {});
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Sales order batch item movement failed.',
    }, { status: 500 });
  }
}
