import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import {
  createStockAllocation,
  listStockAllocations,
  mutateStockAllocation,
  StockAllocationConflict,
} from '@/lib/ims/stockAllocation/service';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const search = new URL(req.url).searchParams;
  const soId = Number(search.get('soId') ?? 0);
  const poId = Number(search.get('poId') ?? 0);
  if ((!Number.isInteger(soId) || soId < 0) || (!Number.isInteger(poId) || poId < 0) || (!soId && !poId)) {
    return NextResponse.json({ success: false, error: 'A valid soId or poId is required.' }, { status: 400 });
  }
  try {
    const data = await listStockAllocations({ businessId: session.businessId, soId: soId || undefined, poId: poId || undefined });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    await reportRuntimeIssue({
      businessId: session.businessId, source: 'ims_stock_allocations', operation: 'list',
      title: 'Stock allocations could not be loaded', error,
      reference: { type: soId ? 'sales_order' : 'purchase_order', id: String(soId || poId) },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  try {
    const body = await req.json();
    const result = await createStockAllocation({
      businessId: session.businessId,
      operationKey: String(body.operationKey ?? ''),
      soItemId: Number(body.soItemId),
      poItemId: Number(body.poItemId),
      quantity: Number(body.quantity),
      promisedDate: typeof body.promisedDate === 'string' ? body.promisedDate : null,
      priority: Number(body.priority ?? 0),
      overrideReason: typeof body.overrideReason === 'string' ? body.overrideReason : null,
      actorId: session.userId ?? null,
      actorName: session.name ?? session.email ?? null,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    if (error instanceof StockAllocationConflict) {
      return NextResponse.json({ success: false, error: error.message, code: 'stock_allocation_conflict' }, { status: 409 });
    }
    const message = String(error?.message ?? 'Stock allocation failed.');
    if (/required|greater than zero|finite/i.test(message)) {
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }
    await reportRuntimeIssue({
      businessId: session.businessId, source: 'ims_stock_allocations', operation: 'allocate',
      title: 'Incoming stock allocation failed', error,
      reference: { type: 'stock_allocation' },
    });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  let allocationReference = '';
  try {
    const body = await req.json();
    allocationReference = Number.isFinite(Number(body.allocationId)) ? String(body.allocationId) : '';
    const result = await mutateStockAllocation({
      businessId: session.businessId,
      operationKey: String(body.operationKey ?? ''),
      allocationId: Number(body.allocationId),
      revision: Number(body.revision),
      action: body.action,
      quantity: body.quantity == null ? undefined : Number(body.quantity),
      poItemId: body.poItemId == null ? undefined : Number(body.poItemId),
      promisedDate: typeof body.promisedDate === 'string' ? body.promisedDate : null,
      reason: typeof body.reason === 'string' ? body.reason : null,
      actorId: session.userId ?? null,
      actorName: session.name ?? session.email ?? null,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    if (error instanceof StockAllocationConflict) {
      return NextResponse.json({ success: false, error: error.message, code: 'stock_allocation_conflict' }, { status: 409 });
    }
    const message = String(error?.message ?? 'Stock allocation update failed.');
    if (/required|greater than zero|valid allocation|valid destination/i.test(message)) {
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }
    await reportRuntimeIssue({
      businessId: session.businessId, source: 'ims_stock_allocations', operation: 'mutate',
      title: 'Incoming stock allocation update failed', error,
      reference: { type: 'stock_allocation', id: allocationReference },
    });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}