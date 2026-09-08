import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { ProductBuildConflictError } from '@/lib/ims/builds/buildService';
import { buildAndConfirmSalesOrder } from '@/lib/ims/builds/salesOrderBuildService';
import { triggerSOXeroSync } from '@/lib/ims/xeroHooks';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const soId = Number(params.id);
  if (!Number.isInteger(soId) || soId <= 0) return NextResponse.json({ error: 'Invalid sales order ID.' }, { status: 400 });
  try {
    const body = await req.json();
    const data = await buildAndConfirmSalesOrder({
      businessId: session.businessId,
      soId,
      operationKey: String(body.operationKey ?? '').trim(),
      builds: Array.isArray(body.builds) ? body.builds.map((build: any) => ({
        outputVariantId: String(build.outputVariantId ?? ''),
        recipeRevision: Number(build.recipeRevision),
      })) : [],
      actorId: session.userId,
      actorName: session.name ?? session.email,
    });
    triggerSOXeroSync(session.businessId, soId, 'confirmed').catch(() => {});
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const status = error instanceof ProductBuildConflictError ? 409 : 500;
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof ProductBuildConflictError ? { code: error.code, ...error.details } : {}),
    }, { status });
  }
}