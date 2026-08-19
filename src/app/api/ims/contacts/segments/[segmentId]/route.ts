import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { deleteContactCrmSegment, getContactCrmSegmentMembers, updateContactCrmSegment } from '@/lib/ims/contactCrmGrowthService';
import { crmRouteError, crmWriteGuard } from '../../_crmRouteHelpers';

export async function GET(_: Request, { params }: { params: { segmentId: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    return NextResponse.json({ success: true, data: await getContactCrmSegmentMembers(session.businessId, Number(params.segmentId)) });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'evaluate_segment', 0);
  }
}

export async function PATCH(request: Request, { params }: { params: { segmentId: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const denied = crmWriteGuard(session);
  if (denied) return denied;
  try {
    await updateContactCrmSegment(session.businessId, Number(params.segmentId), await request.json());
    return NextResponse.json({ success: true });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'update_segment', 0);
  }
}

export async function DELETE(_: Request, { params }: { params: { segmentId: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const denied = crmWriteGuard(session);
  if (denied) return denied;
  try {
    await deleteContactCrmSegment(session.businessId, Number(params.segmentId));
    return NextResponse.json({ success: true });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'delete_segment', 0);
  }
}
