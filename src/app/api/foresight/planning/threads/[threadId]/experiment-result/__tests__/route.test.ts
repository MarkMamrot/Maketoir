import { beforeEach, describe, expect, it, vi } from 'vitest';
const { session, tier, getForThread, create, runIms, getTimeZone, report } = vi.hoisted(() => ({ session: vi.fn(), tier: vi.fn(), getForThread: vi.fn(), create: vi.fn(), runIms: vi.fn(), getTimeZone: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: session, requireAdminTier: tier }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: runIms }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ DEFAULT_BUSINESS_TIME_ZONE: 'Australia/Sydney', getBusinessTimeZone: getTimeZone }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: report }));
vi.mock('@/lib/foresight/repositories/ForesightCampaignExperimentResultRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/foresight/repositories/ForesightCampaignExperimentResultRepository')>();
  return { CampaignExperimentResultTransitionError: actual.CampaignExperimentResultTransitionError, ForesightCampaignExperimentResultRepository: { getForThread, create } };
});
import { CampaignExperimentResultTransitionError } from '@/lib/foresight/repositories/ForesightCampaignExperimentResultRepository';
import { GET, POST } from '../route';
const context = { params: { threadId: '12' } };
const body = { launchId: 66, experimentVersionId: 55, experimentHash: 'c'.repeat(64), source: 'verified_export', observedFrom: '2026-08-10', observedThrough: '2026-08-16',
  qualityIssues: [], control: { sampleSize: 1000, conversions: 50, guardrailEvents: { unsubscribe_rate: 10 } }, treatment: { sampleSize: 1000, conversions: 90, guardrailEvents: { unsubscribe_rate: 11 } }, evaluatedBy: 999 };

describe('/api/foresight/planning/threads/[threadId]/experiment-result', () => {
  beforeEach(() => {
    vi.clearAllMocks(); session.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } }); tier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    getForThread.mockResolvedValue(null); runIms.mockImplementation(async (_businessId: string, callback: () => unknown) => callback()); getTimeZone.mockResolvedValue('Australia/Sydney'); create.mockResolvedValue({ id: 77 });
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
});