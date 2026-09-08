import { NextRequest, NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { previewProductBuildBatch } from '@/lib/ims/builds/buildService';
import { advisorReadOnly, buildRouteError } from '../_routeSupport';

export async function POST(request: NextRequest) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return advisorReadOnly();
  try {
    const body = await request.json().catch(() => ({}));
    const data = await previewProductBuildBatch({
      businessId: session.businessId,
      locationId: body.locationId,
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
    return buildRouteError(error, { businessId: session.businessId, operation: 'preview' });
  }
}