import { NextRequest, NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { reverseProductBuild } from '@/lib/ims/builds/buildService';
import { advisorReadOnly, buildRouteError } from '../../../_routeSupport';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return advisorReadOnly();
  const buildItemId = Number(params.id);
  if (!Number.isInteger(buildItemId) || buildItemId <= 0) {
    return NextResponse.json({ error: 'A valid build item id is required.' }, { status: 400 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const data = await reverseProductBuild({
      businessId: session.businessId,
      buildItemId,
      quantity: body.quantity,
      reason: body.reason,
      operationKey: body.operationKey,
      actorId: session.userId,
      actorName: session.name ?? session.email,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return buildRouteError(error, {
      businessId: session.businessId,
      operation: 'reverse',
      reference: { type: 'product_build_item', id: buildItemId },
    });
  }
}