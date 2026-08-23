import { describe, expect, it } from 'vitest';

import {
  addBusinessDays,
  buildEscalationMessage,
  classifyAssistantOutcome,
  createAssistantPublicReference,
  normalizeWorkflowFindingEvidence,
  workflowFindingFingerprint,
} from '../policy';

describe('assistant outcome policy', () => {
  it('escalates verified operational failures as technical blockers', () => {
    expect(classifyAssistantOutcome({ operationalFailure: true })).toEqual({
      kind: 'technical_blocker',
      shouldCreateRuntimeIssue: true,
      shouldCreateWorkflowFinding: false,
      shouldCreateUserCase: true,
      shouldNotifyDevelopers: true,
    });
  });

  it('explains an intentional alternative without escalating', () => {
    expect(classifyAssistantOutcome({
      essentialOutcome: true,
      supportedAlternativeFound: true,
      supportedAlternativeMeetsConstraints: true,
    }).kind).toBe('answer');
  });

  it('requires clarification before treating an uncertain alternative as a blocker', () => {
    expect(classifyAssistantOutcome({
      essentialOutcome: true,
      supportedAlternativeFound: true,
      needsClarification: true,
    }).kind).toBe('clarification');
  });

  it('creates a workflow finding for deterministic contradictions', () => {
    expect(classifyAssistantOutcome({ deterministicContradiction: true })).toEqual(expect.objectContaining({
      kind: 'workflow_blocker',
      shouldCreateWorkflowFinding: true,
      shouldNotifyDevelopers: true,
    }));
  });

  it('creates a workflow finding for a user-confirmed essential blocker', () => {
    expect(classifyAssistantOutcome({ essentialOutcome: true, userConfirmedBlocked: true }).kind)
      .toBe('workflow_blocker');
  });

  it.each([
    { unsupportedRequest: true },
    { permissionDenied: true },
    { validationFailure: true },
    { lowConfidence: true },
    { essentialOutcome: true },
  ])('does not escalate an unqualified outcome %#', signals => {
    const decision = classifyAssistantOutcome(signals);
    expect(decision.shouldNotifyDevelopers).toBe(false);
    expect(decision.shouldCreateUserCase).toBe(false);
  });
});

describe('workflow finding evidence', () => {
  const evidence = {
    category: 'workflow_gap' as const,
    audience: 'ims' as const,
    capability: 'Customer orders',
    goal: 'Keep an unfilled balance open after a partial shipment',
    essentialConstraints: ['Do not duplicate stock movement', 'Keep the original order number'],
    attemptedPath: 'Complete the order',
    alternativesChecked: [{ path: 'Partial fulfilment', limitation: 'None' }],
    userConfirmedBlocked: true,
    currentView: 'sales-orders',
  };

  it('normalizes and bounds evidence without retaining arbitrary object fields', () => {
    const normalized = normalizeWorkflowFindingEvidence({
      ...evidence,
      goal: `  ${'goal '.repeat(200)}  `,
      essentialConstraints: Array.from({ length: 20 }, (_, index) => `constraint ${index}`),
    });
    expect(normalized.goal.length).toBeLessThanOrEqual(500);
    expect(normalized.essentialConstraints).toHaveLength(12);
  });

  it('uses a stable fingerprint when constraint order changes', () => {
    const first = workflowFindingFingerprint(evidence);
    const second = workflowFindingFingerprint({
      ...evidence,
      essentialConstraints: [...evidence.essentialConstraints].reverse(),
    });
    expect(first).toBe(second);
  });
});

describe('assistant escalation presentation', () => {
  it('calculates the third business day across a weekend', () => {
    expect(addBusinessDays(new Date('2026-08-21T10:00:00.000Z'), 3).toISOString())
      .toBe('2026-08-26T10:00:00.000Z');
  });

  it('creates non-sequential public references', () => {
    expect(createAssistantPublicReference()).toMatch(/^SOL-[A-F0-9]{8}$/);
  });

  it('uses distinct fixed copy for workflow and unreachable POS cases', () => {
    expect(buildEscalationMessage('workflow_blocker', 'SOL-ABC12345')).toContain('supported workflow');
    expect(buildEscalationMessage('technical_blocker', 'SOL-ABC12345', false)).toContain('manager or support team');
  });
});