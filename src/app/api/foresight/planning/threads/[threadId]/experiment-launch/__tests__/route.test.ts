import { beforeEach, describe, expect, it, vi } from 'vitest';
const { session, tier, getForThread, create, runIms, getTimeZone, report } = vi.hoisted(() => ({ session: vi.fn(), tier: vi.fn(), getForThread: vi.fn(), create: vi.fn(), runIms: vi.fn(), getTimeZone: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: session, requireAdminTier: tier }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: runIms }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ DEFAULT_BUSINESS_TIME_ZONE: 'Australia/Sydney', getBusinessTimeZone: getTimeZone }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: report }));
vi.mock('@/lib/foresight/repositories/ForesightCampaignExperimentLaunchRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/foresight/repositories/ForesightCampaignExperimentLaunchRepository')>();
  return { CampaignExperimentLaunchValidationError: actual.CampaignExperimentLaunchValidationError, ForesightCampaignExperimentLaunchRepository: { getForThread, create } };
});
import { CampaignExperimentLaunchValidationError } from '@/lib/foresight/repositories/ForesightCampaignExperimentLaunchRepository';
import { GET, POST } from '../route';
const context = { params: { threadId: '12' } };

describe('/api/foresight/planning/threads/[threadId]/experiment-launch', () => {
  beforeEach(() => {
    vi.clearAllMocks(); session.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } }); tier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    getForThread.mockResolvedValue(null); runIms.mockImplementation(async (_businessId: string, callback: () => unknown) => callback()); getTimeZone.mockResolvedValue('Australia/Sydney'); create.mockResolvedValue({ id: 66 });
  });
  it('reads only through the session tenant', async () => {
    expect((await GET(new Request('http://localhost'), context)).status).toBe(200); expect(getForThread).toHaveBeenCalledWith('business-1', 12);
  });
  it('records through the Admin tenant and ignores browser actor identity', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      experimentVersionId: 55, experimentHash: 'c'.repeat(64), launchedOn: '2026-08-01', scheduledEndOn: '2026-08-07', channel: 'klaviyo',
      controlExternalId: 'control', treatmentExternalId: 'treatment', controlAllocation: 50, treatmentAllocation: 50, targetSamplePerVariant: 500,
      randomAssignmentAttested: true, singleVariableAttested: true, implementationDetails: 'Configured.', operatorNote: 'Checked.', launchedBy: 999,
    }) }), context);
    expect(response.status).toBe(201); expect(create).toHaveBeenCalledWith('business-1', 12, expect.objectContaining({ experimentVersionId: 55, launchedBy: 7 }));
  });
  it('returns expected validation failures as 422 without a runtime issue', async () => {
    create.mockRejectedValue(new CampaignExperimentLaunchValidationError('Mismatch.'));
    const response = await POST(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experimentVersionId: 55, experimentHash: 'c'.repeat(64) }) }), context);
    expect(response.status).toBe(422); expect((await response.json()).code).toBe('EXPERIMENT_LAUNCH_REJECTED'); expect(report).not.toHaveBeenCalled();
  });
});