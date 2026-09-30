import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import {
  PurchaseOrderTransferConflict,
  transferPurchaseOrderItems,
} from '@/lib/ims/orderTransfers/purchaseOrderTransfer';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type TransferRequest = {
  targetOrderId?: number;
  operationKey?: string;
  expectedSourceUpdatedAt?: string | null;
  expectedTargetUpdatedAt?: string | null;
  lines?: Array<{
    sourceItemId?: number;
    quantity?: number;
    allocations?: Array<{ allocationId?: number; revision?: number; quantity?: number }>;
  }>;
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const sourceOrderId = Number(params.id);
  if (!Number.isInteger(sourceOrderId) || sourceOrderId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid purchase order ID.' }, { status: 400 });
  }
  const businessId = String(session.businessId);
  let targetOrderId: number | null = null;
  try {
    const body = await req.json() as TransferRequest;
    targetOrderId = Number(body.targetOrderId);
    const result = await transferPurchaseOrderItems({
      businessId, sourceOrderId, targetOrderId,
      operationKey: String(body.operationKey ?? ''),
      expectedSourceUpdatedAt: body.expectedSourceUpdatedAt ?? null,
      expectedTargetUpdatedAt: body.expectedTargetUpdatedAt ?? null,
      lines: Array.isArray(body.lines) ? body.lines.map(line => ({
        sourceItemId: Number(line.sourceItemId), quantity: Number(line.quantity),
        allocations: Array.isArray(line.allocations) ? line.allocations.map(allocation => ({
          allocationId: Number(allocation.allocationId), revision: Number(allocation.revision),
          quantity: Number(allocation.quantity),
        })) : [],
      })) : [],
      actorId: session.userId == null ? null : Number(session.userId),
      actorName: session.name ?? session.email ?? null,
    });
    if (result.variantIds.length > 0) refreshVariantCache(result.variantIds).catch(() => {});
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ success: false, error: 'Request body must be valid JSON.' }, { status: 400 });
    if (error instanceof PurchaseOrderTransferConflict) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId, source: 'ims_purchase_orders', operation: 'move_purchase_order_items',
      title: 'Purchase order item movement failed', error,
      context: { sourceOrderId, targetOrderId },
      reference: { type: 'purchase_order', id: String(sourceOrderId) },
    }).catch(() => {});
    return NextResponse.json({ success: false,
      error: error instanceof Error ? error.message : 'Purchase order item movement failed.' }, { status: 500 });
  }
}