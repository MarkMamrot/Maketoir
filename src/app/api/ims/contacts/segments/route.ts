import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { createContactCrmSegment, listContactCrmSegments } from '@/lib/ims/contactCrmGrowthService';
import { crmActor, crmRouteError, crmWriteGuard } from '../_crmRouteHelpers';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    return NextResponse.json({ success: true, data: await listContactCrmSegments(session.businessId) });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'list_segments', 0);
  }
}

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const denied = crmWriteGuard(session);
  if (denied) return denied;
  try {
    const id = await createContactCrmSegment(session.businessId, await request.json(), crmActor(session));
    return NextResponse.json({ success: true, id }, { status: 201 });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'create_segment', 0);
  }
}
