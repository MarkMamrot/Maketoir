import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import {
  FIFO_COSTING_ACTIVATION_READY,
  previewInventoryCostMethodSwitch,
  switchInventoryCostMethod,
} from '@/lib/ims/costing/inventoryCostSwitch';
import { FifoCostingConflict } from '@/lib/ims/costing/fifoCostingService';
import { isInventoryCostMethod } from '@/lib/ims/costing/inventoryCosting';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

function isAdministrator(tier: string | null | undefined): boolean {
  return tier === 'Admin' || tier === 'SuperAdmin';
}

export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!isAdministrator(session.tier)) return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  const targetMethod = new URL(request.url).searchParams.get('targetMethod');
  if (!isInventoryCostMethod(targetMethod)) {
    return NextResponse.json({ success: false, error: 'targetMethod must be average_cost or fifo.' }, { status: 400 });
  }
  try {
    const preview = await previewInventoryCostMethodSwitch(String(session.businessId), targetMethod);
    return NextResponse.json({ success: true, preview });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: String(session.businessId),
      source: 'ims.inventory_costing',
      operation: 'preview_method_switch',
      title: 'Inventory costing switch preview failed',
      error,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Inventory costing preview could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!isAdministrator(session.tier)) return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  if (!FIFO_COSTING_ACTIVATION_READY) {
    return NextResponse.json({
      success: false,
      error: 'FIFO activation is not available until all inventory workflows are compatible.',
    }, { status: 423 });
  }
  const businessId = String(session.businessId);
  try {
    const body = await request.json();
    if (!isInventoryCostMethod(body?.targetMethod)) {
      return NextResponse.json({ success: false, error: 'targetMethod must be average_cost or fifo.' }, { status: 400 });
    }
    const result = await switchInventoryCostMethod({
      businessId,
      targetMethod: body.targetMethod,
      expectedRevision: Number(body.expectedRevision),
      operationKey: String(body.operationKey ?? ''),
      reason: String(body.reason ?? ''),
      actorId: session.userId ?? null,
      actorName: session.name ?? session.email ?? null,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof FifoCostingConflict) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof SyntaxError || error instanceof Error && /required|must be|500 characters/.test(error.message)) {
      return NextResponse.json({ success: false, error: error instanceof SyntaxError ? 'Invalid request body.' : error.message }, { status: 400 });
    }
    await reportRuntimeIssue({
      businessId,
      source: 'ims.inventory_costing',
      operation: 'apply_method_switch',
      title: 'Inventory costing method switch failed',
      error,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Inventory costing method could not be changed.' }, { status: 500 });
  }
}