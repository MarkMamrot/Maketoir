import { NextResponse } from 'next/server';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { deliverProspectLeadAlert } from '@/lib/salesAssistant/leadAlerts';
import { salesAssistantRepository } from '@/lib/salesAssistant/repository';
import { applyProspectCookie, enforcePublicRateLimits, publicErrorResponse, publicSession, readBoundedJson, requireSameOrigin } from '@/lib/salesAssistant/routeSupport';
import type { SyncBooksEnquiryDetails } from '@/lib/salesAssistant/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let leadId: number | null = null;
  try {
    requireSameOrigin(request);
    const session = publicSession(request);
    await enforcePublicRateLimits({ request, sessionId: session.sessionId, operation: 'lead', sessionLimit: 5, networkLimit: 10, windowSeconds: 3600, dailySessionLimit: 10, dailyNetworkLimit: 25 });
    const body = await readBoundedJson(request);
    const reject = (error: string) => applyProspectCookie(NextResponse.json({ error }, { status: 400 }), session.cookie);
    if (body.website) return reject('Request rejected.');
    for (const [field, limit] of [['name', 255], ['business', 255], ['email', 320], ['software', 1000], ['needs', 3000]] as const) {
      if (body[field] != null && (typeof body[field] !== 'string' || (body[field] as string).length > limit)) return reject(`Invalid ${field}.`);
    }
    if (typeof body.business !== 'string' || !body.business.trim()) return reject('Business name is required.');
    if (body.consentEmail !== true) return reject('Explicit email consent is required.');
    const teamSize = body.employees ?? '';
    const deliveryModel = body.delivery ?? '';
    if (!['', '1-5 employees', '6-15 employees', '16-35 employees', '35+ employees'].includes(teamSize as string)
      || !['', 'Local', 'Overseas', 'Blended'].includes(deliveryModel as string)) return reject('Invalid support preferences.');
    const idempotencyKey = request.headers.get('idempotency-key') || '';
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(idempotencyKey)) return reject('A valid request key is required.');
    const created = await salesAssistantRepository.createConsentedLead({
      sessionId: session.sessionId, idempotencyKey: `syncbooks:${idempotencyKey}`,
      lead: { name: typeof body.name === 'string' ? body.name : '', company: body.business,
        email: typeof body.email === 'string' ? body.email : '', currentSystems: typeof body.software === 'string' ? body.software : null,
        preferredContact: 'email', consentEmail: true, consentPhone: false, consentSms: false, sourcePath: '/syncbooks',
        enquiryDetails: { service: 'syncbooks', teamSize, deliveryModel, needs: body.needs ?? '' } as SyncBooksEnquiryDetails },
    });
    leadId = created.leadId;
    let alertSent = false;
    try {
      alertSent = await deliverProspectLeadAlert(leadId);
    } catch {
      await reportRuntimeIssue({ source: 'SyncBooksEnquiry', operation: 'notify_lead', title: 'SyncBooks notification queued for retry', error: new Error('Notification delivery unavailable.'), context: { leadId, retryable: true }, reference: { type: 'prospect_lead', id: leadId } }).catch(() => null);
    }
    return applyProspectCookie(NextResponse.json({ reference: `SL-${leadId}`, alertSent, alertQueued: !alertSent }, { status: 201 }), session.cookie);
  } catch (error) {
    const response = publicErrorResponse(error);
    if (response.status >= 500) await reportRuntimeIssue({ source: 'SyncBooksEnquiry', operation: 'create_lead', title: 'SyncBooks enquiry failed', error: new Error('SyncBooks enquiry could not be processed.'), context: { leadId, committed: leadId !== null }, reference: leadId ? { type: 'prospect_lead', id: leadId } : undefined }).catch(() => null);
    return response;
  }
}