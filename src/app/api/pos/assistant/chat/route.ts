import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { handleAssistantChat } from '@/lib/assistant/routeHandlers';
import { getPosSession } from '@/lib/sessionUtils';
import type { UserTier } from '@/lib/tierUtils';

export async function POST(request: Request) {
  const session = getPosSession() as (ReturnType<typeof getPosSession> & {
    businessId?: string; tier?: UserTier; register_id?: number | null; register_name?: string | null;
  });
  if (!session?.businessId || !session.pos_user_id || !session.location_id) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  await getImsSession(['pos_session']);
  return handleAssistantChat(request, {
    audience: 'pos', businessId: session.businessId, posUserId: session.pos_user_id,
    locationId: session.location_id, locationName: session.location_name,
    registerId: session.register_id ?? null, registerName: session.register_name ?? null,
    tier: session.tier ?? 'PosUser',
  }, {
    audience: 'pos', businessId: session.businessId, actorType: 'pos_user',
    actorId: String(session.pos_user_id), canFollowUpDirectly: false,
  });
}