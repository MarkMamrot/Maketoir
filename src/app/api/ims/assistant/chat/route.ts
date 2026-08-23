import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { handleAssistantChat } from '@/lib/assistant/routeHandlers';
import type { UserTier } from '@/lib/tierUtils';

const IMS_TIERS = new Set<UserTier>(['SuperAdmin', 'Admin', 'StandardUser', 'Advisor']);

export async function POST(request: Request) {
  const session = await getImsSession();
  const tier = session?.tier as UserTier | undefined;
  if (!session?.businessId || !session.userId || !tier || !IMS_TIERS.has(tier)) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  return handleAssistantChat(request, {
    audience: 'ims', businessId: session.businessId, userId: session.userId, tier,
  }, {
    audience: 'ims', businessId: session.businessId, actorType: 'ims_user',
    actorId: String(session.userId), canFollowUpDirectly: Boolean(session.email),
  });
}