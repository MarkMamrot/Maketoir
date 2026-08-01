import { describe, expect, it } from 'vitest';
import { hashForesightCampaignLesson, parseForesightCampaignLessonDocument } from '../planning/campaignLessonDocument';

const expected = { outcomeId: 93, activationId: 91, outcomeFactId: 'foresight:campaign-outcome:93:activation:91' };
const document = {
  schemaVersion: 1, outcomeId: 93, activationId: 91, title: 'Meta campaign observation',
  observations: [{ text: 'Contribution was higher in the follow-up window.', citationFactIds: [expected.outcomeFactId] }],
  limitations: ['The comparison is observational and does not establish causality.'],
  hypotheses: [{ text: 'The product selection may merit another controlled test.', status: 'requires_human_validation', validationApproach: 'Run a separately reviewed campaign.' }],
  suggestedApplications: [{ text: 'Consider this evidence when planning related products.', executable: false }],
};

describe('campaign lesson document', () => {
  it('parses and hashes a governed non-executable lesson', () => {
    const parsed = parseForesightCampaignLessonDocument(document, expected);
    expect(parsed.hypotheses[0].status).toBe('requires_human_validation');
    expect(hashForesightCampaignLesson(parsed)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects foreign citations, causal-limit omissions, and executable applications', () => {
    expect(() => parseForesightCampaignLessonDocument({
      ...document,
      observations: [{ text: 'Claim.', citationFactIds: ['other-fact'] }],
      limitations: [],
      suggestedApplications: [{ text: 'Change budget.', executable: true }],
    }, expected)).toThrow('Invalid Foresight campaign lesson');
  });
});