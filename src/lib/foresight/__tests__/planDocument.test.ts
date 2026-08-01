import { describe, expect, it } from 'vitest';
import {
  ForesightPlanValidationError,
  hashForesightPlan,
  parseForesightPlanDocument,
  renderForesightPlanMarkdown,
} from '../planning/planDocument';

const validPlan = {
  schemaVersion: 1,
  title: 'Meta acquisition review',
  objective: 'Improve profitable customer acquisition without interrupting campaign learning.',
  planningHorizon: '2026 Q3',
  strategyVersion: 2,
  recommendationIds: [20],
  humanGoals: ['Grow new-customer revenue'],
  targetAudiences: ['Australian gift buyers'],
  constraints: ['Protect contribution POAS above 3'],
  citations: [{
    factId: 'foresight:recommendation:20',
    source: 'Foresight recommendation 20',
    authority: 'diagnostic',
    observedFrom: '2026-07-25',
    observedThrough: '2026-07-31',
  }],
  statements: [{
    kind: 'fact',
    text: 'Meta campaign ROAS was below the diagnostic boundary.',
    citationFactIds: ['foresight:recommendation:20'],
  }, {
    kind: 'human_context',
    text: 'The campaign is testing new video creative.',
    citationFactIds: [],
  }],
  questions: [{
    id: 'launch-date',
    question: 'When did the new creative launch?',
    rationale: 'Learning maturity changes the intervention.',
    requiredFor: ['budget decision'],
    status: 'open',
    answer: null,
  }],
  options: [{
    id: 'observe',
    title: 'Observe and validate',
    summary: 'Validate tracking and collect three more complete days.',
    benefits: ['Protects learning'],
    risks: ['Additional inefficient spend'],
    evidenceRequired: ['Creative launch date'],
  }],
  selectedOptionId: 'observe',
  actions: [{
    id: 'tracking-review',
    title: 'Review Meta tracking',
    actionType: 'review_measurement',
    owner: 'human',
    executable: false,
    rationale: 'Attribution is diagnostic.',
    dependencies: [],
  }],
  successMetrics: ['Contribution POAS remains above 3'],
  guardrails: ['No budget mutation before human approval'],
  monitoringPlan: { reviewDate: '2026-08-04', stopConditions: ['Contribution POAS falls below 3'] },
  confidence: 0.7,
};

describe('Foresight plan document', () => {
  it('parses a governed plan and renders its evidence and human questions', () => {
    const plan = parseForesightPlanDocument(validPlan);
    const markdown = renderForesightPlanMarkdown(plan);

    expect(plan.actions[0].executable).toBe(false);
    expect(markdown).toContain('# Meta acquisition review');
    expect(markdown).toContain('When did the new creative launch?');
    expect(markdown).toContain('[foresight:recommendation:20]');
  });

  it('rejects uncited facts, invented citations, executable actions, and unknown selected options', () => {
    expect(() => parseForesightPlanDocument({
      ...validPlan,
      statements: [{ kind: 'fact', text: 'Unsupported fact.', citationFactIds: ['missing'] }],
      selectedOptionId: 'missing',
      actions: [{ ...validPlan.actions[0], executable: true }],
    })).toThrow(ForesightPlanValidationError);

    try {
      parseForesightPlanDocument({
        ...validPlan,
        statements: [{ kind: 'fact', text: 'Unsupported fact.', citationFactIds: ['missing'] }],
        selectedOptionId: 'missing',
        actions: [{ ...validPlan.actions[0], executable: true }],
      });
    } catch (error) {
      expect((error as ForesightPlanValidationError).issues).toEqual(expect.arrayContaining([
        expect.stringContaining('unknown fact'),
        expect.stringContaining('selectedOptionId'),
        expect.stringContaining('executable must be false'),
      ]));
    }
  });

  it('hashes equivalent plan objects deterministically', () => {
    const plan = parseForesightPlanDocument(validPlan);
    const reordered = parseForesightPlanDocument({
      title: validPlan.title,
      ...validPlan,
    });

    expect(hashForesightPlan(plan)).toBe(hashForesightPlan(reordered));
  });
});