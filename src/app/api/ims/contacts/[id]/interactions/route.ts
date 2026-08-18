import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { createContactCrmInteraction, listContactCrmInteractions } from '@/lib/ims/contactCrmService';
import { crmActor, crmRouteError, crmWriteGuard } from '../../_crmRouteHelpers';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const contactId = Number(params.id);
  try {
    return NextResponse.json({ success: true, data: await listContactCrmInteractions(session.businessId, contactId) });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'list_interactions', contactId);
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const denied = crmWriteGuard(session);
  if (denied) return denied;
  const contactId = Number(params.id);
  try {
    const body = await req.json();
    const id = await createContactCrmInteraction(session.businessId, contactId, body, crmActor(session));
    return NextResponse.json({ success: true, id }, { status: 201 });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'create_interaction', contactId);
  }
}