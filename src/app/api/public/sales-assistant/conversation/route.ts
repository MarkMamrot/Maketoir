import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { salesAssistantRepository } from '@/lib/salesAssistant/repository';
import { applyProspectCookie, enforcePublicRateLimits, publicErrorResponse, publicSession, readBoundedJson, requireSameOrigin } from '@/lib/salesAssistant/routeSupport';
import { readProspectSessionId } from '@/lib/salesAssistant/session';

export async function GET(request: Request) {
  try {
    const sessionId = readProspectSessionId(request.headers.get('cookie'));
    if (!sessionId) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    const conversationId = new URL(request.url).searchParams.get('conversationId') || '';
    const conversation = conversationId
      ? await salesAssistantRepository.getOwnedConversation({ conversationId, sessionId })
      : await salesAssistantRepository.getLatestOwnedConversation({ sessionId });
    return conversation ? NextResponse.json(conversation) : NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  } catch (error) {
    const response = publicErrorResponse(error);
    if (response.status >= 500) await reportRuntimeIssue({
      source: 'ProspectConversationRoute', operation: 'restore_conversation',
      title: 'Prospect conversation restore failed', error, context: { method: 'GET' },
    }).catch(() => null);
    return response;
  }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const session = publicSession(request);
    await enforcePublicRateLimits({ request, sessionId: session.sessionId, operation: 'delete_conversation', sessionLimit: 5, networkLimit: 10, windowSeconds: 3600 });
    const body = await readBoundedJson(request);
    const conversationId = new URL(request.url).searchParams.get('conversationId')
      || (typeof body.conversationId === 'string' ? body.conversationId : '');
    const deleted = await salesAssistantRepository.deleteOwnedConversation({ conversationId, sessionId: session.sessionId });
    const response = deleted ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    return applyProspectCookie(response, session.cookie);
  } catch (error) {
    const response = publicErrorResponse(error);
    if (response.status >= 500) await reportRuntimeIssue({
      source: 'ProspectConversationRoute', operation: 'delete_conversation',
      title: 'Prospect conversation deletion failed', error, context: { method: 'DELETE' },
    }).catch(() => null);
    return response;
  }
}
