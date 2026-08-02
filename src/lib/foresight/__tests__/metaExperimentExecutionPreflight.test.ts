import { describe, expect, it } from 'vitest';
import { buildMetaExperimentExecutionPreflight, metaExperimentExecutionFingerprint } from '../metaExperimentExecutionPreflight';
import type { ForesightCampaignExperimentDocument } from '../planning/campaignExperimentDocument';

const design: ForesightCampaignExperimentDocument = {
  schemaVersion: 1, lessonVersionId: 3, lessonHash: 'a'.repeat(64), title: 'Offer test',
  hypothesis: { text: 'Offer improves conversion.', citationFactIds: ['lesson:3'] }, channel: 'meta', audience: 'Visitors',
  control: { name: 'Control', description: 'Baseline.' }, treatment: { name: 'Treatment', description: 'Offer.' },
  allocationPercent: { control: 50, treatment: 50 }, startDate: '2026-08-01', endDate: '2026-08-07',
  minimumSamplePerVariant: 500, primaryMetric: 'conversion_rate', minimumDetectableLiftPercent: 10,
  guardrails: [{ metric: 'meta_negative_feedback_rate', maximumAdverseChangePercent: 20 }],
  analysis: { method: 'frequentist_two_sided', confidenceLevel: 0.95, inconclusiveWhenUnderpowered: true },
  limitations: ['Meta attribution applies.'], executable: false,
};
const campaigns = [
  { campaignId: 'c1', campaignName: 'Control', accountId: '123', objective: 'OUTCOME_SALES', configuredStatus: 'PAUSED', effectiveStatus: 'PAUSED' },
  { campaignId: 'c2', campaignName: 'Treatment', accountId: '123', objective: 'OUTCOME_SALES', configuredStatus: 'PAUSED', effectiveStatus: 'PAUSED' },
];
function build(overrides: Partial<Parameters<typeof buildMetaExperimentExecutionPreflight>[0]> = {}) {
  return buildMetaExperimentExecutionPreflight({
    now: new Date('2026-08-01T00:01:01.000Z'), businessToday: '2026-08-01', experimentVersionId: 7,
    experimentHash: 'b'.repeat(64), design, packageConfirmationId: 9, packageFingerprint: 'c'.repeat(64),
    accountId: '123', businessManagerId: '456', controlCampaignId: 'c1', treatmentCampaignId: 'c2', campaigns,
    ...overrides,
  });
}

describe('buildMetaExperimentExecutionPreflight', () => {
  it('binds exact campaigns, allocation, ownership, and rounded timestamps', () => {
    const result = build();
    expect(result.ready).toBe(true);
    expect(result.startTime).toBe(Date.parse('2026-08-01T00:05:00.000Z') / 1_000);
    expect(result.executionFingerprint).toBe(metaExperimentExecutionFingerprint(result));
    expect(result.executionFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('blocks date and campaign-state drift', () => {
    expect(build({ businessToday: '2026-07-31' }).blockers.map(({ code }) => code)).toContain('outside_accepted_start_date');
    const active = campaigns.map((campaign) => campaign.campaignId === 'c2' ? { ...campaign, configuredStatus: 'ACTIVE', effectiveStatus: 'ACTIVE' } : campaign);
    expect(build({ campaigns: active }).blockers.map(({ code }) => code)).toContain('campaign_state_drift');
  });

  it('changes authorization when exact execution timing changes', () => {
    expect(build().executionFingerprint).not.toBe(build({ now: new Date('2026-08-01T00:06:00.000Z') }).executionFingerprint);
  });
});
