import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { createContactCrmOpportunity } from '@/lib/ims/contactCrmGrowthService';
import { crmActor, crmRouteError, crmWriteGuard, resolveCrmAssignee } from '../../_crmRouteHelpers';

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const denied = crmWriteGuard(session);
  if (denied) return denied;
  let contactId = 0;
  try {
    const body = await request.json();
    contactId = Number(body.contactId) || 0;
    const owner = await resolveCrmAssignee(session.businessId, body.ownerUserId);
    const id = await createContactCrmOpportunity(session.businessId, { ...body, ownerUserId: owner.id, ownerName: owner.name }, crmActor(session));
    return NextResponse.json({ success: true, id }, { status: 201 });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'create_opportunity', contactId);
  }
}
