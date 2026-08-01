import { describe, expect, it } from 'vitest';
import { hashForesightCampaignExperiment, parseForesightCampaignExperimentDocument } from '../planning/campaignExperimentDocument';

const expected = { lessonVersionId: 44, lessonHash: 'a'.repeat(64), lessonFactId: 'foresight:campaign-lesson:44:v1' };
const document = {
  schemaVersion: 1, lessonVersionId: 44, lessonHash: expected.lessonHash, title: 'Offer message experiment',
  hypothesis: { text: 'The accepted lesson suggests testing clearer offer framing.', citationFactIds: [expected.lessonFactId] },
  channel: 'klaviyo', audience: 'Eligible Australian subscribers randomly assigned before send.',
  control: { name: 'Current framing', description: 'Use the accepted control message.' },
  treatment: { name: 'Clearer framing', description: 'Change only the offer framing.' },
  allocationPercent: { control: 50, treatment: 50 }, startDate: '2026-08-10', endDate: '2026-08-16',
  minimumSamplePerVariant: 500, primaryMetric: 'conversion_rate', minimumDetectableLiftPercent: 10,
  guardrails: [{ metric: 'unsubscribe_rate', maximumAdverseChangePercent: 20 }],
  analysis: { method: 'frequentist_two_sided', confidenceLevel: 0.95, inconclusiveWhenUnderpowered: true },
  limitations: ['Cross-device attribution may be incomplete.'], executable: false,
};

describe('campaign experiment document', () => {
  it('parses and hashes a measurable non-executable experiment', () => {
    const parsed = parseForesightCampaignExperimentDocument(document, expected);
    expect(parsed.analysis.inconclusiveWhenUnderpowered).toBe(true);
    expect(hashForesightCampaignExperiment(parsed)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects foreign lesson evidence and an invalid or executable design', () => {
    expect(() => parseForesightCampaignExperimentDocument({ ...document,
      hypothesis: { text: 'Claim', citationFactIds: ['other'] }, allocationPercent: { control: 70, treatment: 20 },
      startDate: '2026-08-20', endDate: '2026-08-10', guardrails: [], executable: true,
    }, expected)).toThrow('Invalid Foresight campaign experiment');
  });
});