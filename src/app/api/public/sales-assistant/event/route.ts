import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { salesAssistantRepository } from '@/lib/salesAssistant/repository';
import { applyProspectCookie, enforcePublicRateLimits, publicErrorResponse, publicSession, readBoundedJson, requireSameOrigin } from '@/lib/salesAssistant/routeSupport';

const EVENT_TYPES = new Set([
  'assistant_impression', 'hero_prompt_focus', 'hero_prompt_send', 'launcher_open',
  'first_meaningful_turn', 'second_meaningful_turn', 'suggested_prompt', 'contact_cta_shown',
  'contact_cta_opened', 'contact_cta_dismissed', 'consented_submit', 'demo_click',
  'trial_click', 'pricing_click', 'close', 'pagehide', 'return',
]);

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const session = publicSession(request);
    await enforcePublicRateLimits({ request, sessionId: session.sessionId, operation: 'event', sessionLimit: 60, networkLimit: 120, windowSeconds: 60, dailySessionLimit: 500, dailyNetworkLimit: 1500 });
    const body = await readBoundedJson(request, 10_000);
    const eventType = typeof body.eventType === 'string' ? body.eventType : '';
    if (!EVENT_TYPES.has(eventType)) return applyProspectCookie(NextResponse.json({ error: 'Unsupported event type.' }, { status: 400 }), session.cookie);
    const idempotencyKey = String(body.eventId || request.headers.get('idempotency-key') || '').trim();
    const result = await salesAssistantRepository.recordEvent({
      idempotencyKey,
      eventType,
      conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
      sessionId: session.sessionId,
      data: body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : {},
    });
    return applyProspectCookie(NextResponse.json(result, { status: 201 }), session.cookie);
  } catch (error) {
    const response = publicErrorResponse(error);
    if (response.status >= 500) await reportRuntimeIssue({
      source: 'ProspectEventRoute', operation: 'record_event', title: 'Prospect event recording failed', error,
      context: { endpoint: 'public_sales_event' },
    }).catch(() => null);
    return response;
  }
}
