import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { getProductBuildBatch } from '@/lib/ims/builds/buildService';
import { buildRouteError } from '../_routeSupport';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'A valid build id is required.' }, { status: 400 });
  try {
    const data = await getProductBuildBatch(session.businessId, id);
    if (!data) return NextResponse.json({ error: 'Product build not found.' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return buildRouteError(error, {
      businessId: session.businessId,
      operation: 'detail',
      reference: { type: 'product_build', id },
    });
  }
}