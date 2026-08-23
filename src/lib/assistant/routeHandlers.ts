import { NextResponse } from 'next/server';

import { escalateBlockedAssistantRequest } from './escalation';
import { candidateMatchesIdentity, signAssistantCandidate, verifyAssistantCandidate } from './candidateToken';
import { runAssistant, type AssistantChatMessage } from './orchestrator';
import type { AssistantPrincipal } from './tools';
import type { AssistantAudience, WorkflowFindingEvidence } from './policy';
import { checkAssistantRateLimit } from './rateLimit';
import { sanitizeAssistantScreenContext } from './screenContext';

export interface AssistantRouteIdentity {
  businessId: string;
  audience: AssistantAudience;
  actorType: 'ims_user' | 'pos_user' | 'wholesale_member';
  actorId: string;
  canFollowUpDirectly: boolean;
}

function parseHistory(value: unknown): AssistantChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-6).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const message = item as Record<string, unknown>;
    if (message.role !== 'user' && message.role !== 'assistant') return [];
    const content = String(message.content ?? '').trim().slice(0, 1_000);
    return content ? [{ role: message.role, content }] : [];
  });
}

export async function handleAssistantChat(
  request: Request,
  principal: AssistantPrincipal,
  identity: AssistantRouteIdentity,
): Promise<NextResponse> {
  const rateLimit = checkAssistantRateLimit(`${identity.businessId}:${identity.actorType}:${identity.actorId}:chat`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many assistant requests. Please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const message = String(body?.message ?? '').trim();
  if (!message || message.length > 2_000) {
    return NextResponse.json({ error: 'Message must be between 1 and 2,000 characters.' }, { status: 400 });
  }
  const currentView = String(body?.currentView ?? '').trim().slice(0, 100) || null;
  const screenContext = sanitizeAssistantScreenContext(body?.screenContext);
  try {
    const response = await runAssistant({
      principal,
      message,
      history: parseHistory(body?.history),
      currentView,
      screenContext,
    });
    const candidateToken = response.workflowCandidate
      ? signAssistantCandidate({
        businessId: identity.businessId,
        audience: identity.audience,
        actorType: identity.actorType,
        actorId: identity.actorId,
        currentView,
        candidate: response.workflowCandidate,
        promptVersion: response.promptVersion,
        indexVersion: response.indexVersion,
      })
      : null;
    return NextResponse.json({ ...response, candidateToken });
  } catch (error) {
    const escalation = await escalateBlockedAssistantRequest({
      kind: 'technical_blocker',
      businessId: identity.businessId,
      audience: identity.audience,
      actorType: identity.actorType,
      actorId: identity.actorId,
      canFollowUpDirectly: identity.canFollowUpDirectly,
      currentView,
      runtimeIssue: {
        source: `solvantis_assistant_${identity.audience}`,
        operation: 'answer_request',
        title: 'Solvantis Assistant could not complete a request',
        error,
        context: { audience: identity.audience, currentView, actorType: identity.actorType },
        reference: { type: identity.actorType, id: identity.actorId },
      },
    });
    return NextResponse.json({
      answer: escalation.message,
      citations: [],
      toolUsed: null,
      toolsUsed: [],
      workflowCandidate: null,
      candidateToken: null,
      escalated: escalation.escalated,
      publicReference: escalation.escalated ? escalation.publicReference : null,
    });
  }
}

export async function handleAssistantWorkflowConfirmation(
  request: Request,
  identity: AssistantRouteIdentity,
): Promise<NextResponse> {
  const rateLimit = checkAssistantRateLimit(`${identity.businessId}:${identity.actorType}:${identity.actorId}:review`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many review requests. Please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const token = String(body?.candidateToken ?? '');
  const signedCandidate = token ? verifyAssistantCandidate(token) : null;
  if (!signedCandidate || !candidateMatchesIdentity(signedCandidate, identity)) {
    return NextResponse.json({ error: 'This workflow review request is invalid or has expired.' }, { status: 400 });
  }
  const candidate = signedCandidate.candidate;
  const evidence: WorkflowFindingEvidence = {
    category: candidate.category,
    audience: identity.audience,
    capability: candidate.capability,
    goal: candidate.goal,
    essentialConstraints: candidate.essentialConstraints,
    attemptedPath: candidate.attemptedPath,
    alternativesChecked: candidate.alternativesChecked,
    userConfirmedBlocked: true,
    currentView: signedCandidate.currentView,
  };
  const escalation = await escalateBlockedAssistantRequest({
    kind: 'workflow_blocker',
    businessId: identity.businessId,
    audience: identity.audience,
    actorType: identity.actorType,
    actorId: identity.actorId,
    canFollowUpDirectly: identity.canFollowUpDirectly,
    currentView: signedCandidate.currentView,
    workflowFinding: {
      businessId: identity.businessId,
      evidence,
      impact: 'high',
      confidence: 0.7,
      promptVersion: signedCandidate.promptVersion,
      indexVersion: signedCandidate.indexVersion,
      toolManifestVersion: '1',
    },
  });
  return NextResponse.json({
    answer: escalation.message,
    escalated: escalation.escalated,
    publicReference: escalation.escalated ? escalation.publicReference : null,
  });
}