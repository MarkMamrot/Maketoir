import { NextRequest, NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { completeProductBuildBatch, listProductBuildBatches } from '@/lib/ims/builds/buildService';
import { advisorReadOnly, buildRouteError } from './_routeSupport';

export async function GET(request: NextRequest) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const search = request.nextUrl.searchParams;
  try {
    const data = await listProductBuildBatches(session.businessId, {
      page: Number(search.get('page') ?? 1),
      pageSize: Number(search.get('pageSize') ?? 25),
      locationId: search.get('locationId') ? Number(search.get('locationId')) : undefined,
      status: search.get('status') || undefined,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return buildRouteError(error, { businessId: session.businessId, operation: 'list' });
  }
}

export async function POST(request: NextRequest) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return advisorReadOnly();
  try {
    const body = await request.json().catch(() => ({}));
    const data = await completeProductBuildBatch({
      businessId: session.businessId,
      locationId: body.locationId,
      operationKey: body.operationKey,
      builds: body.builds,
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      sourceChannel: body.sourceChannel,
      notes: body.notes,
      actorId: session.userId,
      actorName: session.name ?? session.email,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return buildRouteError(error, { businessId: session.businessId, operation: 'complete' });
  }
}