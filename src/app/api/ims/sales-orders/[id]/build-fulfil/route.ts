import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { ProductBuildConflictError } from '@/lib/ims/builds/buildService';
import { buildAndFulfilSalesOrder } from '@/lib/ims/builds/salesOrderBuildService';
import { StockShortfallError } from '@/lib/ims/orderResolution/stockShortfall';
import { triggerSOXeroSync } from '@/lib/ims/xeroHooks';
import { FifoCostingConflict } from '@/lib/ims/costing/fifoCostingService';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const soId = Number(params.id);
  if (!Number.isInteger(soId) || soId <= 0) return NextResponse.json({ error: 'Invalid sales order ID.' }, { status: 400 });
  try {
    const body = await req.json();
    const data = await buildAndFulfilSalesOrder({
      businessId: session.businessId,
      soId,
      operationKey: String(body.operationKey ?? '').trim(),
      shipmentQuantities: Array.isArray(body.shipmentQuantities) ? body.shipmentQuantities : [],
      builds: Array.isArray(body.builds) ? body.builds.map((build: any) => ({
        outputVariantId: String(build.outputVariantId ?? ''),
        recipeRevision: Number(build.recipeRevision),
      })) : [],
      actorId: session.userId,
      actorName: session.name ?? session.email,
    });
    if (data.fulfilment.status === 'fulfilled') {
      triggerSOXeroSync(session.businessId, soId, 'fulfilled').catch(() => {});
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof StockShortfallError) {
      return NextResponse.json({ error: error.message, code: error.code, shortfalls: error.shortfalls }, { status: 409 });
    }
    if (error instanceof FifoCostingConflict) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const status = error instanceof ProductBuildConflictError ? 409 : 500;
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof ProductBuildConflictError ? { code: error.code, ...error.details } : {}),
    }, { status });
  }
}