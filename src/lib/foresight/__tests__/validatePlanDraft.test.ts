import { describe, expect, it } from 'vitest';
import { parseForesightPlanDocument } from '../planning/planDocument';
import { validatePlanDraft } from '../planning/validatePlanDraft';

const fact = {
  factId: 'foresight:recommendation:20:fingerprint', label: 'Recommendation', source: 'Foresight Recommendation Ledger',
  authority: 'diagnostic' as const, observedFrom: '2026-07-25', observedThrough: '2026-07-31', freshnessAt: '2026-08-01',
  quality: { grade: 'good', issues: [] }, value: { recommendationId: 20 },
};
const links = [{ id: 1, business_id: 'business-1', thread_id: 12, plan_version_id: null, link_type: 'recommendation' as const, link_id: '20', created_at: '2026-08-01' }];
const planInput = {
  schemaVersion: 1, title: 'Recommendation plan', objective: 'Improve profitable growth.', planningHorizon: '30 days',
  strategyVersion: null, recommendationIds: [20], humanGoals: ['Profitable growth'], targetAudiences: ['Gift buyers'], constraints: [],
  citations: [{ factId: fact.factId, source: fact.source, authority: fact.authority, observedFrom: fact.observedFrom, observedThrough: fact.observedThrough }],
  statements: [{ kind: 'fact', text: 'A recommendation exists.', citationFactIds: [fact.factId] }], questions: [],
  options: [{ id: 'review', title: 'Review', summary: 'Review the recommendation.', benefits: ['Governed'], risks: ['Delay'], evidenceRequired: [] }],
  selectedOptionId: 'review', actions: [{ id: 'review', title: 'Review recommendation', actionType: 'human_review', owner: 'ai_draft', executable: false, rationale: 'Human approval is required.', dependencies: [] }],
  successMetrics: ['Contribution remains positive'], guardrails: ['No execution through planning chat'],
  monitoringPlan: { reviewDate: '2026-08-08', stopConditions: ['Contribution deteriorates'] }, confidence: 0.7,
};

describe('validatePlanDraft', () => {
  it('passes a complete plan using exact audited facts and durable links', () => {
    expect(validatePlanDraft(parseForesightPlanDocument(planInput), [fact], links)).toMatchObject({ state: 'passed' });
  });

  it('fails invented citations and linked recommendation mismatches', () => {
    const plan = parseForesightPlanDocument({
      ...planInput, recommendationIds: [21],
      citations: [{ ...planInput.citations[0], factId: 'invented' }],
      statements: [{ kind: 'fact', text: 'Invented.', citationFactIds: ['invented'] }],
    });
    const result = validatePlanDraft(plan, [fact], links);
    expect(result.state).toBe('failed');
    expect(result.findings.blocking).toEqual(expect.arrayContaining([
      expect.stringContaining('not present'), expect.stringContaining('exactly match'),
    ]));
  });

  it('requires human input when questions remain or no option is selected', () => {
    const plan = parseForesightPlanDocument({
      ...planInput, selectedOptionId: null,
      questions: [{ id: 'budget', question: 'What budget?', rationale: 'Sets scope.', requiredFor: ['execution'], status: 'open', answer: null }],
    });
    expect(validatePlanDraft(plan, [fact], links)).toMatchObject({
      state: 'needs_human', findings: { needsHuman: expect.arrayContaining([expect.stringContaining('unresolved'), expect.stringContaining('selected')]) },
    });
  });

  it('rejects recommendation claims when the thread has no matching durable link', () => {
    const result = validatePlanDraft(parseForesightPlanDocument(planInput), [fact], []);
    expect(result).toMatchObject({
      state: 'failed', findings: { blocking: [expect.stringContaining('exactly match')] },
    });
  });
});