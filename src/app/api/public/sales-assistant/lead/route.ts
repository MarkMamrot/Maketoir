import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { deliverProspectLeadAlert } from '@/lib/salesAssistant/leadAlerts';
import { salesAssistantRepository } from '@/lib/salesAssistant/repository';
import { applyProspectCookie, enforcePublicRateLimits, publicErrorResponse, publicSession, readBoundedJson, requireSameOrigin } from '@/lib/salesAssistant/routeSupport';
import type { ProspectLeadInput, ProspectPreferredContact } from '@/lib/salesAssistant/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let leadId: number | null = null;
  try {
    requireSameOrigin(request);
    const session = publicSession(request);
    await enforcePublicRateLimits({ request, sessionId: session.sessionId, operation: 'lead', sessionLimit: 5, networkLimit: 10, windowSeconds: 3600, dailySessionLimit: 10, dailyNetworkLimit: 25 });
    const body = await readBoundedJson(request);
    if (typeof body.website === 'string' && body.website.trim()) return applyProspectCookie(NextResponse.json({ error: 'Request rejected.' }, { status: 400 }), session.cookie);
    const preferredContact = body.preferredContact as ProspectPreferredContact;
    if (!['email', 'phone', 'sms'].includes(preferredContact)) return applyProspectCookie(NextResponse.json({ error: 'A valid preferred contact channel is required.' }, { status: 400 }), session.cookie);
    const lead: ProspectLeadInput = {
      conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
      name: typeof body.name === 'string' ? body.name : '',
      company: typeof body.company === 'string' ? body.company : null,
      email: typeof body.email === 'string' ? body.email : null,
      phone: typeof body.phone === 'string' ? body.phone : null,
      preferredContact,
      consentEmail: body.consentEmail === true,
      consentPhone: body.consentPhone === true,
      consentSms: body.consentSms === true,
      locations: typeof body.locations === 'string' ? body.locations : null,
      currentSystems: typeof body.currentSystems === 'string' ? body.currentSystems : null,
      timeframe: typeof body.timeframe === 'string' ? body.timeframe : null,
      sourcePath: typeof body.sourcePath === 'string' ? body.sourcePath : null,
    };
    const idempotencyKey = String(request.headers.get('idempotency-key') || body.idempotencyKey || '').trim();
    const created = await salesAssistantRepository.createConsentedLead({ idempotencyKey, sessionId: session.sessionId, lead });
    leadId = created.leadId;
    const alertSent = await deliverProspectLeadAlert(leadId);
    return applyProspectCookie(NextResponse.json({ leadId, reference: `SL-${leadId}`, alertSent, alertQueued: !alertSent }, { status: 201 }), session.cookie);
  } catch (error) {
    const response = publicErrorResponse(error);
    if (response.status >= 500) await reportRuntimeIssue({
      source: 'ProspectLeadRoute', operation: 'create_lead', title: 'Prospect lead request failed', error,
      context: { leadId, committed: leadId != null }, reference: leadId ? { type: 'prospect_lead', id: leadId } : undefined,
    }).catch(() => null);
    return response;
  }
}
