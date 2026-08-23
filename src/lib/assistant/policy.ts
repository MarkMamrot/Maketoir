import { createHash, randomBytes } from 'node:crypto';

export type AssistantAudience = 'ims' | 'pos' | 'wholesale';

export type AssistantOutcomeKind =
  | 'answer'
  | 'clarification'
  | 'abstain'
  | 'technical_blocker'
  | 'workflow_blocker';

export type WorkflowFindingCategory =
  | 'logical_flow_error'
  | 'workflow_gap'
  | 'missing_capability'
  | 'edge_case'
  | 'documentation_gap';

export interface AssistantOutcomeSignals {
  operationalFailure?: boolean;
  deterministicContradiction?: boolean;
  essentialOutcome?: boolean;
  userConfirmedBlocked?: boolean;
  supportedAlternativeFound?: boolean;
  supportedAlternativeMeetsConstraints?: boolean;
  needsClarification?: boolean;
  unsupportedRequest?: boolean;
  permissionDenied?: boolean;
  validationFailure?: boolean;
  lowConfidence?: boolean;
}

export interface AssistantOutcomeDecision {
  kind: AssistantOutcomeKind;
  shouldCreateRuntimeIssue: boolean;
  shouldCreateWorkflowFinding: boolean;
  shouldCreateUserCase: boolean;
  shouldNotifyDevelopers: boolean;
}

export interface WorkflowFindingEvidence {
  category: WorkflowFindingCategory;
  audience: AssistantAudience;
  capability: string;
  goal: string;
  essentialConstraints: string[];
  attemptedPath?: string | null;
  alternativesChecked: Array<{ path: string; limitation?: string | null }>;
  deterministicRule?: string | null;
  userConfirmedBlocked: boolean;
  currentView?: string | null;
}

const MAX_EVIDENCE_TEXT = 500;
const MAX_CONSTRAINTS = 12;
const MAX_ALTERNATIVES = 12;

function boundedText(value: unknown, maxLength = MAX_EVIDENCE_TEXT): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function classifyAssistantOutcome(signals: AssistantOutcomeSignals): AssistantOutcomeDecision {
  if (signals.operationalFailure) {
    return {
      kind: 'technical_blocker',
      shouldCreateRuntimeIssue: true,
      shouldCreateWorkflowFinding: false,
      shouldCreateUserCase: true,
      shouldNotifyDevelopers: true,
    };
  }

  if (signals.supportedAlternativeFound && signals.supportedAlternativeMeetsConstraints) {
    return {
      kind: 'answer',
      shouldCreateRuntimeIssue: false,
      shouldCreateWorkflowFinding: false,
      shouldCreateUserCase: false,
      shouldNotifyDevelopers: false,
    };
  }

  if (signals.needsClarification) {
    return {
      kind: 'clarification',
      shouldCreateRuntimeIssue: false,
      shouldCreateWorkflowFinding: false,
      shouldCreateUserCase: false,
      shouldNotifyDevelopers: false,
    };
  }

  const qualifiedWorkflowBlocker = Boolean(
    signals.deterministicContradiction
    || (signals.essentialOutcome && signals.userConfirmedBlocked),
  );
  if (qualifiedWorkflowBlocker) {
    return {
      kind: 'workflow_blocker',
      shouldCreateRuntimeIssue: false,
      shouldCreateWorkflowFinding: true,
      shouldCreateUserCase: true,
      shouldNotifyDevelopers: true,
    };
  }

  if (
    signals.unsupportedRequest
    || signals.permissionDenied
    || signals.validationFailure
    || signals.lowConfidence
  ) {
    return {
      kind: 'abstain',
      shouldCreateRuntimeIssue: false,
      shouldCreateWorkflowFinding: false,
      shouldCreateUserCase: false,
      shouldNotifyDevelopers: false,
    };
  }

  return {
    kind: 'answer',
    shouldCreateRuntimeIssue: false,
    shouldCreateWorkflowFinding: false,
    shouldCreateUserCase: false,
    shouldNotifyDevelopers: false,
  };
}

export function normalizeWorkflowFindingEvidence(input: WorkflowFindingEvidence): WorkflowFindingEvidence {
  return {
    category: input.category,
    audience: input.audience,
    capability: boundedText(input.capability, 100),
    goal: boundedText(input.goal),
    essentialConstraints: input.essentialConstraints
      .slice(0, MAX_CONSTRAINTS)
      .map(constraint => boundedText(constraint, 250))
      .filter(Boolean),
    attemptedPath: input.attemptedPath ? boundedText(input.attemptedPath) : null,
    alternativesChecked: input.alternativesChecked.slice(0, MAX_ALTERNATIVES).map(alternative => ({
      path: boundedText(alternative.path, 250),
      limitation: alternative.limitation ? boundedText(alternative.limitation) : null,
    })).filter(alternative => alternative.path.length > 0),
    deterministicRule: input.deterministicRule ? boundedText(input.deterministicRule, 250) : null,
    userConfirmedBlocked: input.userConfirmedBlocked,
    currentView: input.currentView ? boundedText(input.currentView, 100) : null,
  };
}

export function workflowFindingFingerprint(input: WorkflowFindingEvidence): string {
  const evidence = normalizeWorkflowFindingEvidence(input);
  const normalized = {
    category: evidence.category,
    audience: evidence.audience,
    capability: evidence.capability.toLowerCase(),
    goal: evidence.goal.toLowerCase(),
    constraints: [...evidence.essentialConstraints].map(value => value.toLowerCase()).sort(),
    rule: evidence.deterministicRule?.toLowerCase() ?? null,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function addBusinessDays(start: Date, businessDays: number): Date {
  const result = new Date(start);
  let remaining = Math.max(0, Math.trunc(businessDays));
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

export function createAssistantPublicReference(): string {
  return `SOL-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export function buildEscalationMessage(
  kind: 'technical_blocker' | 'workflow_blocker',
  publicReference: string,
  canFollowUpDirectly = true,
): string {
  const reference = boundedText(publicReference, 32);
  if (!canFollowUpDirectly) {
    return `I couldn't complete that request, so I've notified our technical team. Please keep this reference for your manager or support team: ${reference}.`;
  }
  if (kind === 'workflow_blocker') {
    return `I couldn't find a supported workflow that meets those requirements, so I've escalated this for review. We'll follow up within 2-3 business days. Reference: ${reference}.`;
  }
  return `I couldn't complete that request, so I've escalated it to our technical team. We'll follow up within 2-3 business days. Reference: ${reference}.`;
}