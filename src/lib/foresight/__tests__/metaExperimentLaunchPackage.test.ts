import { describe, expect, it } from 'vitest';
import { buildMetaExperimentLaunchPackage } from '../metaExperimentLaunchPackage';
import type { ForesightCampaignExperimentDocument } from '../planning/campaignExperimentDocument';

const design: ForesightCampaignExperimentDocument = {
  schemaVersion: 1, lessonVersionId: 3, lessonHash: 'a'.repeat(64), title: 'Offer test',
  hypothesis: { text: 'A stronger offer will improve conversion.', citationFactIds: ['lesson:3'] },
  channel: 'meta', audience: 'Recent visitors',
  control: { name: 'Baseline offer', description: 'Current creative.' },
  treatment: { name: 'Free shipping offer', description: 'Single changed offer.' },
  allocationPercent: { control: 50, treatment: 50 }, startDate: '2026-08-01', endDate: '2026-08-07',
  minimumSamplePerVariant: 500, primaryMetric: 'conversion_rate', minimumDetectableLiftPercent: 10,
  guardrails: [{ metric: 'meta_negative_feedback_rate', maximumAdverseChangePercent: 20 }],
  analysis: { method: 'frequentist_two_sided', confidenceLevel: 0.95, inconclusiveWhenUnderpowered: true },
  limitations: ['Meta attribution applies.'], executable: false,
};

const campaigns = [
  { campaignId: 'c1', campaignName: 'Baseline offer AU', accountId: '123', objective: 'OUTCOME_SALES', configuredStatus: 'PAUSED', effectiveStatus: 'PAUSED' },
  { campaignId: 'c2', campaignName: 'Free shipping offer AU', accountId: '123', objective: 'OUTCOME_SALES', configuredStatus: 'PAUSED', effectiveStatus: 'PAUSED' },
  { campaignId: 'c3', campaignName: 'Archived baseline', accountId: '123', objective: 'OUTCOME_SALES', configuredStatus: 'ARCHIVED', effectiveStatus: 'ARCHIVED' },
  { campaignId: 'c4', campaignName: 'Free shipping elsewhere', accountId: '999', objective: 'OUTCOME_SALES', configuredStatus: 'PAUSED', effectiveStatus: 'PAUSED' },
];

function build(overrides: Partial<Parameters<typeof buildMetaExperimentLaunchPackage>[0]> = {}) {
  return buildMetaExperimentLaunchPackage({ experimentVersionId: 7, experimentHash: 'b'.repeat(64), design, accountId: 'act_123', campaigns, checkedAt: '2026-07-30T00:00:00.000Z', ...overrides });
}

describe('buildMetaExperimentLaunchPackage', () => {
  it('ranks live candidates but requires explicit exact variant mappings', () => {
    const result = build();
    expect(result.ready).toBe(false);
    expect(result.recommendedControlCampaignId).toBe('c1');
    expect(result.recommendedTreatmentCampaignId).toBe('c2');
    expect(result.confirmationFingerprint).toBeNull();
    expect(result.candidates.find(({ campaignId }) => campaignId === 'c3')?.selectable).toBe(false);
    expect(result.candidates.find(({ campaignId }) => campaignId === 'c4')?.selectable).toBe(false);
  });

  it('binds distinct live campaign identities to a deterministic fingerprint', () => {
    const first = build({ controlCampaignId: 'c1', treatmentCampaignId: 'c2' });
    const second = build({ controlCampaignId: 'c1', treatmentCampaignId: 'c2', checkedAt: '2026-07-31T00:00:00.000Z' });
    expect(first.ready).toBe(true);
    expect(first.blockers).toEqual([]);
    expect(first.confirmationFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.confirmationFingerprint).toBe(second.confirmationFingerprint);
  });

  it('blocks duplicate, unavailable, and incompatible mappings', () => {
    expect(build({ controlCampaignId: 'c1', treatmentCampaignId: 'c1' }).blockers.map(({ code }) => code)).toContain('duplicate_variant_campaign');
    expect(build({ controlCampaignId: 'c1', treatmentCampaignId: 'c3' }).blockers.map(({ code }) => code)).toContain('treatment_campaign_unavailable');
    expect(build({ design: { ...design, primaryMetric: 'revenue_per_session' }, controlCampaignId: 'c1', treatmentCampaignId: 'c2' }).blockers.map(({ code }) => code)).toContain('unsupported_measurement_contract');
  });
});
