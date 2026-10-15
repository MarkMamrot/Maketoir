import { SECURITY_POLICIES } from './policies';

export type PolicyEvidenceKind = 'log_review' | 'adoption' | 'policy_review';

export interface PolicyEvidenceRequest {
  policyId: string;
  kind: PolicyEvidenceKind;
  expectedRevision: number;
  policyHash: string;
  operationKey: string;
  summary: string;
  evidenceReference: string;
  reviewFrom: string | null;
  reviewThrough: string | null;
  acknowledged: true;
}

export interface PolicyEvidenceRecord {
  id: number;
  policyId: string;
  kind: PolicyEvidenceKind;
  policyVersion: string;
  policyHash: string;
  assignmentRevision: number;
  actorUserId: number;
  summary: string;
  evidenceReference: string;
  recordedAt: string;
  reviewFrom: string | null;
  reviewThrough: string | null;
}

export interface PolicyEvidenceState {
  policies: Array<{
    id: string;
    hash: string;
    adoptedAt: string | null;
    reviewedAt: string | null;
    nextReviewAt: string | null;
  }>;
  lastLogReviewAt: string | null;
  nextLogReviewAt: string | null;
  history: PolicyEvidenceRecord[];
}

export class PolicyEvidenceValidationError extends Error {}

export function validatePolicyEvidenceRequest(value: unknown): PolicyEvidenceRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PolicyEvidenceValidationError('Provide a valid policy evidence request.');
  }
  const input = value as Record<string, unknown>;
  const keys = ['policyId', 'kind', 'expectedRevision', 'policyHash', 'operationKey', 'summary', 'evidenceReference', 'reviewFrom', 'reviewThrough', 'acknowledged'];
  if (Object.keys(input).some(key => !keys.includes(key))
    || typeof input.policyId !== 'string' || !SECURITY_POLICIES.some(policy => policy.id === input.policyId)
    || !['log_review', 'adoption', 'policy_review'].includes(String(input.kind))
    || (input.kind === 'log_review' && input.policyId !== 'logging-monitoring')
    || typeof input.expectedRevision !== 'number' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || typeof input.policyHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.policyHash)
    || typeof input.operationKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.operationKey)
    || input.acknowledged !== true) {
    throw new PolicyEvidenceValidationError('Check the policy, saved revision and explicit acknowledgement.');
  }
  if (typeof input.summary !== 'string' || !input.summary.trim() || input.summary.trim().length > 1000
    || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(input.summary)
    || typeof input.evidenceReference !== 'string' || !input.evidenceReference.trim()
    || input.evidenceReference.trim().length > 500 || /[\u0000-\u001f\u007f]/.test(input.evidenceReference)) {
    throw new PolicyEvidenceValidationError('Provide a review/adoption summary (up to 1,000 characters) and a safe evidence reference (up to 500 characters).');
  }
  const validDay = (day: unknown): day is string => typeof day === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day))
    && new Date(day).toISOString().slice(0, 10) === day;
  if (input.kind === 'log_review') {
    if (!validDay(input.reviewFrom) || !validDay(input.reviewThrough) || input.reviewFrom > input.reviewThrough
      || input.reviewThrough > new Date().toISOString().slice(0, 10)) {
      throw new PolicyEvidenceValidationError('Provide the reviewed UTC date period; future reviews cannot be recorded.');
    }
  } else if (input.reviewFrom !== null || input.reviewThrough !== null) {
    throw new PolicyEvidenceValidationError('Log review dates apply only to security log reviews.');
  }
  return {
    policyId: input.policyId, kind: input.kind as PolicyEvidenceKind,
    expectedRevision: input.expectedRevision, policyHash: input.policyHash, operationKey: input.operationKey.toLowerCase(),
    summary: input.summary.trim(), evidenceReference: input.evidenceReference.trim(),
    reviewFrom: input.kind === 'log_review' ? input.reviewFrom as string : null,
    reviewThrough: input.kind === 'log_review' ? input.reviewThrough as string : null, acknowledged: true,
  };
}

export function nextSecurityLogReviewAt(recordedAt: string): string {
  const date = new Date(recordedAt);
  if (!Number.isFinite(date.getTime())) throw new PolicyEvidenceValidationError('Invalid security review date.');
  return new Date(date.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
}

export function nextPolicyReviewAt(policyId: string, recordedAt: string): string {
  if (!SECURITY_POLICIES.some(policy => policy.id === policyId)) throw new PolicyEvidenceValidationError('Unknown policy.');
  const date = new Date(recordedAt);
  if (!Number.isFinite(date.getTime())) throw new PolicyEvidenceValidationError('Invalid policy review date.');
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + (policyId === 'incident-response' ? 6 : 12));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}
