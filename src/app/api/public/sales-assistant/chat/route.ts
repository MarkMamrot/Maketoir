import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { runProspectSalesAssistant } from '@/lib/salesAssistant/orchestrator';
import { salesAssistantRepository } from '@/lib/salesAssistant/repository';
import { applyProspectCookie, enforcePublicRateLimits, publicErrorResponse, publicSession, readBoundedJson, requireSameOrigin } from '@/lib/salesAssistant/routeSupport';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let safeContext: Record<string, unknown> = {};
  try {
    requireSameOrigin(request);
    const session = publicSession(request);
    await enforcePublicRateLimits({ request, sessionId: session.sessionId, operation: 'chat', sessionLimit: 12, networkLimit: 30, windowSeconds: 60, dailySessionLimit: 100, dailyNetworkLimit: 250 });
    const body = await readBoundedJson(request);
    if (typeof body.website === 'string' && body.website.trim()) return applyProspectCookie(NextResponse.json({ error: 'Request rejected.' }, { status: 400 }), session.cookie);
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId.slice(0, 36) : null;
    let history = [];
    if (conversationId) {
      const conversation = await salesAssistantRepository.getOwnedConversation({ conversationId, sessionId: session.sessionId });
      if (!conversation) return applyProspectCookie(NextResponse.json({ error: 'Conversation not found.' }, { status: 404 }), session.cookie);
      history = conversation.messages.map(message => ({ role: message.role, content: message.content }));
    }
    safeContext = { conversationId, hasExistingConversation: Boolean(conversationId) };
    const result = await runProspectSalesAssistant({
      sessionId: session.sessionId,
      conversationId,
      message: typeof body.message === 'string' ? body.message : '',
      history,
      attribution: body.attribution,
    });
    return applyProspectCookie(NextResponse.json(result), session.cookie);
  } catch (error) {
    const response = publicErrorResponse(error);
    if (response.status >= 500) await reportRuntimeIssue({
      source: 'ProspectSalesChatRoute', operation: 'chat', title: 'Public sales chat request failed', error,
      context: safeContext,
    }).catch(() => null);
    return response;
  }
}
