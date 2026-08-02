import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listDue, createResult, getConnections, fetchMeta, fetchGoogle, reportIssue, decrypt } = vi.hoisted(() => ({
  listDue: vi.fn(), createResult: vi.fn(), getConnections: vi.fn(), fetchMeta: vi.fn(), fetchGoogle: vi.fn(), reportIssue: vi.fn(), decrypt: vi.fn(),
}));
vi.mock('@/lib/foresight/repositories/ForesightCampaignExperimentResultRepository', () => ({
  ForesightCampaignExperimentResultRepository: { listDueWithoutResult: listDue, create: createResult },
}));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: getConnections } }));
vi.mock('@/lib/foresight/ForesightMonitoringSyncService', () => ({ fetchMetaDaily: fetchMeta }));
vi.mock('@/services/GoogleAdsService', () => ({ GoogleAdsService: class { getDailyPerformance = fetchGoogle; } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: reportIssue }));
vi.mock('@/lib/encryption', () => ({ decrypt }));

import {
  buildGoogleAdsExperimentObservations,
  buildMetaExperimentObservations,
  ForesightExperimentEvidenceCollectionService,
} from '../ForesightExperimentEvidenceCollectionService';

const due = {
  launch_id: 66, thread_id: 12, experiment_version_id: 55, experiment_hash: 'c'.repeat(64),
  launched_on: '2026-08-10', scheduled_end_on: '2026-08-16', channel: 'meta' as const,
  control_external_id: 'campaign-control', treatment_external_id: 'campaign-treatment',
  experiment_json: {
    schemaVersion: 1 as const, lessonVersionId: 44, lessonHash: 'a'.repeat(64), title: 'Meta purchase experiment',
    hypothesis: { text: 'Test clearer framing.', citationFactIds: ['fact'] }, channel: 'meta' as const, audience: 'Random audience',
    control: { name: 'Control', description: 'Current framing' }, treatment: { name: 'Treatment', description: 'Clear framing' },
    allocationPercent: { control: 50, treatment: 50 }, startDate: '2026-08-10', endDate: '2026-08-16',
    minimumSamplePerVariant: 500, primaryMetric: 'conversion_rate' as const, minimumDetectableLiftPercent: 10,
    guardrails: [{ metric: 'meta_negative_feedback_rate', maximumAdverseChangePercent: 20 }],
    analysis: { method: 'frequentist_two_sided' as const, confidenceLevel: 0.95 as const, inconclusiveWhenUnderpowered: true as const },
    limitations: ['Meta attribution applies.'], executable: false as const,
  },
};

const metaRows = [
  { campaign_id: 'campaign-control', impressions: '1000', actions: [
    { action_type: 'omni_purchase', value: '50' }, { action_type: 'purchase', value: '49' }, { action_type: 'hide_clicks', value: '10' },
  ] },
  { campaign_id: 'campaign-treatment', impressions: '1000', actions: [
    { action_type: 'offsite_conversion.fb_pixel_purchase', value: '75' }, { action_type: 'report_spam_clicks', value: '3' }, { action_type: 'hide_all_clicks', value: '8' },
  ] },
];

describe('ForesightExperimentEvidenceCollectionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDue.mockResolvedValue([due]);
    getConnections.mockResolvedValue({ meta_ad_account_id: 'act_123', meta_access_token: 'encrypted', google_ads_customer_id: '999', google_ads_refresh_token: 'google-encrypted' });
    decrypt.mockReturnValue('decrypted');
    fetchMeta.mockResolvedValue(metaRows);
    createResult.mockResolvedValue({ status: 'treatment_won' });
    reportIssue.mockResolvedValue(undefined);
  });

  it('collects exact Google campaign evidence but remains inconclusive for unsupported guardrail statistics', async () => {
    const googleDue = { ...due, channel: 'google_ads' as const, control_external_id: '101', treatment_external_id: '202',
      experiment_json: { ...due.experiment_json, channel: 'google_ads' as const, guardrails: [{ metric: 'cost_per_conversion', maximumAdverseChangePercent: 20 }] } };
    const rows = [
      { campaign: { id: '101' }, metrics: { impressions: 1000, conversions: 40 } },
      { campaign: { id: '202' }, metrics: { impressions: 1200, conversions: 60 } },
    ];
    expect(buildGoogleAdsExperimentObservations(googleDue, rows)).toMatchObject({
      source: 'google_ads_api:campaign', control: { sampleSize: 1000, conversions: 40 }, treatment: { sampleSize: 1200, conversions: 60 },
      qualityIssues: [expect.stringContaining('sufficient event statistics')],
    });
    listDue.mockResolvedValue([googleDue]); fetchGoogle.mockResolvedValue(rows); createResult.mockResolvedValue({ status: 'inconclusive' });
    const result = await ForesightExperimentEvidenceCollectionService.collectDue('business-1', '2026-08-17');
    expect(decrypt).toHaveBeenCalledWith('google-encrypted');
    expect(fetchGoogle).toHaveBeenCalledWith('2026-08-10', '2026-08-16');
    expect(result.inconclusiveCount).toBe(1);
  });

  it('aggregates exact Meta campaign IDs without double-counting purchase aliases', () => {
    expect(buildMetaExperimentObservations(due, metaRows)).toMatchObject({
      source: 'meta_insights_api:campaign', qualityIssues: [],
      control: { sampleSize: 1000, conversions: 50, guardrailEvents: { meta_negative_feedback_rate: 10 } },
      treatment: { sampleSize: 1000, conversions: 75, guardrailEvents: { meta_negative_feedback_rate: 11 } },
    });
  });

  it('automatically records exact evidence as the system actor', async () => {
    const result = await ForesightExperimentEvidenceCollectionService.collectDue('business-1', '2026-08-17');
    expect(fetchMeta).toHaveBeenCalledWith('act_123', 'decrypted', '2026-08-10', '2026-08-16', 'campaign');
    expect(createResult).toHaveBeenCalledWith('business-1', 12, expect.objectContaining({
      launchId: 66, evaluatedBy: 0,
      observations: expect.objectContaining({ control: expect.objectContaining({ conversions: 50 }) }),
    }));
    expect(result).toEqual({ dueCount: 1, measuredCount: 1, inconclusiveCount: 0, deferredCount: 0 });
  });

  it('locks unsupported channel evidence as an explicit inconclusive conclusion', async () => {
    listDue.mockResolvedValue([{ ...due, channel: 'klaviyo' }]);
    createResult.mockResolvedValue({ status: 'inconclusive' });
    const result = await ForesightExperimentEvidenceCollectionService.collectDue('business-1', '2026-08-17');
    expect(fetchMeta).not.toHaveBeenCalled();
    expect(createResult).toHaveBeenCalledWith('business-1', 12, expect.objectContaining({
      observations: expect.objectContaining({ qualityIssues: [expect.stringContaining('sufficient statistics')] }),
    }));
    expect(result.inconclusiveCount).toBe(1);
  });

  it('defers and reports unexpected platform failures without fabricating a result', async () => {
    fetchMeta.mockRejectedValue(new Error('Meta unavailable'));
    const result = await ForesightExperimentEvidenceCollectionService.collectDue('business-1', '2026-08-17');
    expect(createResult).not.toHaveBeenCalled();
    expect(reportIssue).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', operation: 'collect_due_experiment' }));
    expect(result.deferredCount).toBe(1);
  });
});
