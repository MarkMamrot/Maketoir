import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { confirmSalesOrderWithSourcing, previewSalesOrderSourcing } from '@/lib/ims/salesOrderSourcing';
import { StockAllocationConflict } from '@/lib/ims/stockAllocation/service';
import { triggerSOXeroSync } from '@/lib/ims/xeroHooks';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

function salesOrderId(params: { id: string }): number | null {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const soId = salesOrderId(params);
  if (!soId) return NextResponse.json({ success: false, error: 'Invalid sales order ID.' }, { status: 400 });
  try {
    const data = await previewSalesOrderSourcing({ businessId: session.businessId, soId });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    if (error instanceof StockAllocationConflict) {
      return NextResponse.json({ success: false, error: error.message, code: 'stock_allocation_conflict' }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'ims_sales_orders',
      operation: 'preview_stock_sourcing',
      title: 'Sales order stock sourcing review could not be loaded',
      error,
      reference: { type: 'sales_order', id: String(soId) },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error?.message ?? 'Stock sourcing review failed.' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const soId = salesOrderId(params);
  if (!soId) return NextResponse.json({ success: false, error: 'Invalid sales order ID.' }, { status: 400 });
  try {
    const body = await req.json();
    const result = await confirmSalesOrderWithSourcing({
      businessId: session.businessId,
      soId,
      operationKey: String(body.operationKey ?? ''),
      expectedUpdatedAt: typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null,
      choices: Array.isArray(body.choices) ? body.choices.map((choice: any) => ({
        soItemId: Number(choice.soItemId),
        poItemId: Number(choice.poItemId),
        quantity: Number(choice.quantity),
        promisedDate: typeof choice.promisedDate === 'string' ? choice.promisedDate : null,
      })) : [],
      acknowledgedUnsourcedSoItemIds: Array.isArray(body.acknowledgedUnsourcedSoItemIds)
        ? body.acknowledgedUnsourcedSoItemIds.map(Number)
        : [],
      actorId: session.userId,
      actorName: session.name ?? session.email,
    });
    const variantIds = [...new Set(result.preview.lines.map(line => line.variantId).filter(Boolean))];
    if (variantIds.length > 0) refreshVariantCache(variantIds).catch(() => {});
    triggerSOXeroSync(session.businessId, soId, 'confirmed').catch(() => {});
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    if (error instanceof StockAllocationConflict) {
      return NextResponse.json({ success: false, error: error.message, code: 'stock_allocation_conflict' }, { status: 409 });
    }
    const message = String(error?.message ?? 'Sales order confirmation failed.');
    if (/required|finite|greater than zero/i.test(message)) {
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'ims_sales_orders',
      operation: 'confirm_with_stock_sourcing',
      title: 'Sales order sourcing confirmation failed',
      error,
      reference: { type: 'sales_order', id: String(soId) },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}