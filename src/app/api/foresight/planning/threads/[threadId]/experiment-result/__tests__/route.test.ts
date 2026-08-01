import { beforeEach, describe, expect, it, vi } from 'vitest';
const { session, tier, getForThread, create, latestExperiment, latestReview, getLaunch, runIms, getTimeZone, report } = vi.hoisted(() => ({
  session: vi.fn(), tier: vi.fn(), getForThread: vi.fn(), create: vi.fn(), latestExperiment: vi.fn(), latestReview: vi.fn(), getLaunch: vi.fn(), runIms: vi.fn(), getTimeZone: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: session, requireAdminTier: tier }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: runIms }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ DEFAULT_BUSINESS_TIME_ZONE: 'Australia/Sydney', getBusinessTimeZone: getTimeZone }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: report }));
vi.mock('@/lib/foresight/repositories/ForesightCampaignExperimentResultRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/foresight/repositories/ForesightCampaignExperimentResultRepository')>();
  return { CampaignExperimentResultTransitionError: actual.CampaignExperimentResultTransitionError, ForesightCampaignExperimentResultRepository: { getForThread, create } };
});
vi.mock('@/lib/foresight/repositories/ForesightCampaignExperimentRepository', () => ({
  ForesightCampaignExperimentRepository: { latest: latestExperiment, latestReview },
}));
vi.mock('@/lib/foresight/repositories/ForesightCampaignExperimentLaunchRepository', () => ({
  ForesightCampaignExperimentLaunchRepository: { getForThread: getLaunch },
}));
import { CampaignExperimentResultTransitionError } from '@/lib/foresight/repositories/ForesightCampaignExperimentResultRepository';
import { GET, POST } from '../route';
const context = { params: { threadId: '12' } };
const body = { launchId: 66, experimentVersionId: 55, experimentHash: 'c'.repeat(64), source: 'verified_export', observedFrom: '2026-08-10', observedThrough: '2026-08-16',
  qualityIssues: [], control: { sampleSize: 1000, conversions: 50, guardrailEvents: { unsubscribe_rate: 10 } }, treatment: { sampleSize: 1000, conversions: 90, guardrailEvents: { unsubscribe_rate: 11 } }, evaluatedBy: 999 };

describe('/api/foresight/planning/threads/[threadId]/experiment-result', () => {
  beforeEach(() => {
    vi.clearAllMocks(); session.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } }); tier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    getForThread.mockResolvedValue(null); runIms.mockImplementation(async (_businessId: string, callback: () => unknown) => callback()); getTimeZone.mockResolvedValue('Australia/Sydney'); create.mockResolvedValue({ id: 77 });
    latestExperiment.mockResolvedValue({ id: 55, experiment_hash: 'c'.repeat(64), experiment_json: { primaryMetric: 'conversion_rate', minimumSamplePerVariant: 500, guardrails: [{ metric: 'unsubscribe_rate', maximumAdverseChangePercent: 20 }] } });
    latestReview.mockResolvedValue({ experiment_version_id: 55, experiment_hash: 'c'.repeat(64), action: 'accepted' });
    getLaunch.mockResolvedValue({ id: 66, experiment_version_id: 55, experiment_hash: 'c'.repeat(64), control_external_id: 'control-campaign', treatment_external_id: 'treatment-campaign', launched_on: '2026-08-10', scheduled_end_on: '2026-08-16' });
  });
  it('reads only through the session tenant', async () => {
    expect((await GET(new Request('http://localhost'), context)).status).toBe(200); expect(getForThread).toHaveBeenCalledWith('business-1', 12);
  });
  it('records exact observations with server-controlled tenant and evaluator identity', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), context);
    expect(response.status).toBe(201); expect(create).toHaveBeenCalledWith('business-1', 12, expect.objectContaining({ launchId: 66, evaluatedBy: 7, observations: expect.objectContaining({ source: 'verified_export' }) }));
  });
  it('returns expected transition failures as 422 without a runtime issue', async () => {
    create.mockRejectedValue(new CampaignExperimentResultTransitionError('Too early.'));
    const response = await POST(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), context);
    expect(response.status).toBe(422); expect((await response.json()).code).toBe('EXPERIMENT_RESULT_REJECTED'); expect(report).not.toHaveBeenCalled();
  });
  it('previews a verified CSV against server-loaded exact IDs without persisting', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      operation: 'preview_csv', launchId: 66, experimentVersionId: 55, experimentHash: 'c'.repeat(64), fileName: 'results.csv',
      csv: 'variant_id,sample_size,conversions,guardrail:unsubscribe_rate\ncontrol-campaign,1000,50,10\ntreatment-campaign,1000,90,11',
    }) }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ observations: { source: 'verified_csv:results.csv', control: { sampleSize: 1000, conversions: 50 }, treatment: { conversions: 90 } } });
    expect(latestExperiment).toHaveBeenCalledWith('business-1', 12); expect(create).not.toHaveBeenCalled();
  });
  it('rejects a preview when the requested launch is not the exact tenant launch', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      operation: 'preview_csv', launchId: 99, experimentVersionId: 55, experimentHash: 'c'.repeat(64), fileName: 'results.csv', csv: 'unused',
    }) }), context);
    expect(response.status).toBe(422); expect((await response.json()).code).toBe('EXPERIMENT_EVIDENCE_REJECTED');
    expect(create).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalled();
  });
});