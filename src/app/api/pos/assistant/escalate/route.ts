import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { handleAssistantWorkflowConfirmation } from '@/lib/assistant/routeHandlers';
import { getPosSession } from '@/lib/sessionUtils';

export async function POST(request: Request) {
  const session = getPosSession() as (ReturnType<typeof getPosSession> & { businessId?: string });
  if (!session?.businessId || !session.pos_user_id || !session.location_id) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  await getImsSession(['pos_session']);
  return handleAssistantWorkflowConfirmation(request, {
    audience: 'pos', businessId: session.businessId, actorType: 'pos_user',
    actorId: String(session.pos_user_id), canFollowUpDirectly: false,
  });
}