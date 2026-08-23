import { NextResponse } from 'next/server';

import { salesAssistantRepository } from '@/lib/salesAssistant/repository';
import { applyProspectCookie, enforcePublicRateLimits, publicErrorResponse, publicSession, requireSameOrigin } from '@/lib/salesAssistant/routeSupport';
import { readProspectSessionId } from '@/lib/salesAssistant/session';

export async function GET(request: Request) {
  try {
    const sessionId = readProspectSessionId(request.headers.get('cookie'));
    if (!sessionId) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    const conversationId = new URL(request.url).searchParams.get('conversationId') || '';
    const conversation = await salesAssistantRepository.getOwnedConversation({ conversationId, sessionId });
    return conversation ? NextResponse.json(conversation) : NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const session = publicSession(request);
    await enforcePublicRateLimits({ request, sessionId: session.sessionId, operation: 'delete_conversation', sessionLimit: 5, networkLimit: 10, windowSeconds: 3600 });
    const conversationId = new URL(request.url).searchParams.get('conversationId') || '';
    const deleted = await salesAssistantRepository.deleteOwnedConversation({ conversationId, sessionId: session.sessionId });
    const response = deleted ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    return applyProspectCookie(response, session.cookie);
  } catch (error) {
    return publicErrorResponse(error);
  }
}
