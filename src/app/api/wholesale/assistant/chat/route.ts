import { NextResponse } from 'next/server';

import { handleAssistantChat } from '@/lib/assistant/routeHandlers';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';

export async function POST(request: Request) {
  const { session, brandAccess, response } = await requireActiveWholesaleSession();
  if (response) return response;
  if (session.preview) return NextResponse.json({ error: 'Assistant is unavailable in staff preview.' }, { status: 403 });
  return runImsForBusiness(session.businessId, () => handleAssistantChat(request, {
    audience: 'wholesale', businessId: session.businessId, contactId: session.contactId,
    companyId: session.companyId, locationId: session.locationId, memberId: session.memberId,
    memberRole: session.memberRole, brandAccess,
  }, {
    audience: 'wholesale', businessId: session.businessId, actorType: 'wholesale_member',
    actorId: String(session.memberId), canFollowUpDirectly: Boolean(session.email),
  }));
}