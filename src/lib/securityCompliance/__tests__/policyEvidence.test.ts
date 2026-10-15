import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextPolicyReviewAt, nextSecurityLogReviewAt, PolicyEvidenceValidationError, validatePolicyEvidenceRequest, validateSecurityReviewPeriod } from '../policyEvidence';

const request = () => ({
  policyId: 'logging-monitoring', kind: 'log_review', expectedRevision: 1, policyHash: 'a'.repeat(64),
  operationKey: 'c042862d-870e-45c5-a293-57f2ed3f6ef0', summary: ' Reviewed access and follow-up actions ',
  evidenceReference: ' Restricted review register ', reviewFrom: '2026-10-01', reviewThrough: '2026-10-15', acknowledged: true,
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('policy evidence validation', () => {
  it('normalizes safe fields without accepting a client-selected actor', () => {
    expect(validatePolicyEvidenceRequest(request())).toMatchObject({
      summary: 'Reviewed access and follow-up actions', evidenceReference: 'Restricted review register', acknowledged: true,
    });
    expect(() => validatePolicyEvidenceRequest({ ...request(), actorUserId: 999 })).toThrow(PolicyEvidenceValidationError);
  });

  it.each([
    null, [], {}, { ...request(), expectedRevision: 0 }, { ...request(), expectedRevision: '1' },
    { ...request(), acknowledged: false }, { ...request(), policyId: 'unknown' },
    { ...request(), policyId: 'incident-response' }, { ...request(), policyHash: 'invalid' },
    { ...request(), operationKey: 'not-a-uuid' }, { ...request(), summary: ' ' },
    { ...request(), summary: 'x'.repeat(1001) }, { ...request(), evidenceReference: 'x'.repeat(501) },
    { ...request(), evidenceReference: 'unsafe\nreference' }, { ...request(), summary: 'unsafe\u0000summary' },
    { ...request(), kind: { toString: 'not-callable' } },
  ])('rejects invalid evidence: %j', input => {
    expect(() => validatePolicyEvidenceRequest(input)).toThrow(PolicyEvidenceValidationError);
  });

  it('accepts adoption without log dates and rejects unrelated dates', () => {
    expect(validatePolicyEvidenceRequest({ ...request(), kind: 'adoption', reviewFrom: null, reviewThrough: null }).kind).toBe('adoption');
    expect(() => validatePolicyEvidenceRequest({ ...request(), kind: 'adoption' })).toThrow(PolicyEvidenceValidationError);
  });

  it.each([
    ['2026-02-30', '2026-03-01'], ['2026-10-16', '2026-10-16'], ['2026-10-15', '2026-10-01'],
    ['', '2026-10-15'], ['0000-01-01', '2026-10-15'], ['2026-10-01T00:00:00Z', '2026-10-15'],
  ])('rejects invalid, reversed or future UTC periods', (from, through) => {
    expect(() => validateSecurityReviewPeriod(from, through)).toThrow(PolicyEvidenceValidationError);
  });
});

describe('review deadlines', () => {
  it('uses an exact 14-day log-review cadence', () => {
    expect(nextSecurityLogReviewAt('2026-10-15T12:00:00Z', '2026-10-15')).toBe('2026-10-29T12:00:00.000Z');
  });

  it('does not let a historical review postpone a current deadline', () => {
    expect(nextSecurityLogReviewAt('2026-10-15T12:00:00Z', '2026-10-01')).toBe('2026-10-16T00:00:00.000Z');
  });

  it('uses calendar months and clamps month-end and leap-day dates', () => {
    expect(nextPolicyReviewAt('incident-response', '2026-08-31T12:00:00Z')).toBe('2027-02-28T12:00:00.000Z');
    expect(nextPolicyReviewAt('logging-monitoring', '2024-02-29T12:00:00Z')).toBe('2025-02-28T12:00:00.000Z');
  });

  it('rejects unknown policies and malformed date evidence', () => {
    expect(() => nextPolicyReviewAt('unknown', '2026-10-15')).toThrow(PolicyEvidenceValidationError);
    expect(() => nextPolicyReviewAt('incident-response', 'invalid')).toThrow(PolicyEvidenceValidationError);
    expect(() => nextSecurityLogReviewAt('invalid')).toThrow(PolicyEvidenceValidationError);
    expect(() => nextSecurityLogReviewAt('2026-10-15', '2026-02-30')).toThrow(PolicyEvidenceValidationError);
  });
});
