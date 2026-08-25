import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { getContactCrmProfile, updateContactCrmInteractionBrief } from '@/lib/ims/contactCrmService';
import { crmRouteError, crmWriteGuard } from '../../_crmRouteHelpers';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const contactId = Number(params.id);
  try {
    return NextResponse.json({ success: true, data: await getContactCrmProfile(session.businessId, contactId) });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'load_profile', contactId);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const denied = crmWriteGuard(session);
  if (denied) return denied;
  const contactId = Number(params.id);
  try {
    const body = await req.json();
    const interactionBrief = await updateContactCrmInteractionBrief(session.businessId, contactId, body.interactionBrief);
    return NextResponse.json({ success: true, data: { interactionBrief } });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'update_interaction_brief', contactId);
  }
}