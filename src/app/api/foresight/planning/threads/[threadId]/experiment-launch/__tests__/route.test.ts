import { beforeEach, describe, expect, it, vi } from 'vitest';
const { session, tier, getForThread, create, getPackageConfirmation, buildPackage, confirmPackage, runIms, getTimeZone, report } = vi.hoisted(() => ({ session: vi.fn(), tier: vi.fn(), getForThread: vi.fn(), create: vi.fn(), getPackageConfirmation: vi.fn(), buildPackage: vi.fn(), confirmPackage: vi.fn(), runIms: vi.fn(), getTimeZone: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: session, requireAdminTier: tier }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: runIms }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ DEFAULT_BUSINESS_TIME_ZONE: 'Australia/Sydney', getBusinessTimeZone: getTimeZone }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: report }));
vi.mock('@/lib/foresight/ForesightMetaExperimentLaunchPackageService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/foresight/ForesightMetaExperimentLaunchPackageService')>();
  return { MetaExperimentLaunchPackageValidationError: actual.MetaExperimentLaunchPackageValidationError, ForesightMetaExperimentLaunchPackageService: { build: buildPackage, confirm: confirmPackage } };
});
vi.mock('@/lib/foresight/repositories/ForesightMetaExperimentLaunchPackageRepository', () => ({ ForesightMetaExperimentLaunchPackageRepository: { getForThread: getPackageConfirmation } }));
vi.mock('@/lib/foresight/repositories/ForesightCampaignExperimentLaunchRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/foresight/repositories/ForesightCampaignExperimentLaunchRepository')>();
  return { CampaignExperimentLaunchValidationError: actual.CampaignExperimentLaunchValidationError, ForesightCampaignExperimentLaunchRepository: { getForThread, create } };
});
import { CampaignExperimentLaunchValidationError } from '@/lib/foresight/repositories/ForesightCampaignExperimentLaunchRepository';
import { MetaExperimentLaunchPackageValidationError } from '@/lib/foresight/ForesightMetaExperimentLaunchPackageService';
import { GET, POST } from '../route';
const context = { params: { threadId: '12' } };

describe('/api/foresight/planning/threads/[threadId]/experiment-launch', () => {
  beforeEach(() => {
    vi.clearAllMocks(); session.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } }); tier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    getForThread.mockResolvedValue(null); getPackageConfirmation.mockResolvedValue(null); buildPackage.mockResolvedValue({ ready: false }); confirmPackage.mockResolvedValue({ id: 77 }); runIms.mockImplementation(async (_businessId: string, callback: () => unknown) => callback()); getTimeZone.mockResolvedValue('Australia/Sydney'); create.mockResolvedValue({ id: 66 });
  });
  it('reads only through the session tenant', async () => {
    expect((await GET(new Request('http://localhost'), context)).status).toBe(200); expect(getForThread).toHaveBeenCalledWith('business-1', 12);
  });
  it('builds a Meta package through the session tenant with exact identity and selections', async () => {
    const response = await GET(new Request(`http://localhost?view=meta-package&experimentVersionId=55&experimentHash=${'c'.repeat(64)}&controlCampaignId=c1&treatmentCampaignId=c2`), context);
    expect(response.status).toBe(200);
    expect(buildPackage).toHaveBeenCalledWith('business-1', 12, { experimentVersionId: 55, experimentHash: 'c'.repeat(64), controlCampaignId: 'c1', treatmentCampaignId: 'c2' });
    expect(getPackageConfirmation).toHaveBeenCalledWith('business-1', 12);
    expect(getForThread).not.toHaveBeenCalled();
  });
  it('returns expected package validation failures without a runtime issue', async () => {
    buildPackage.mockRejectedValue(new MetaExperimentLaunchPackageValidationError('Not accepted.'));
    const response = await GET(new Request(`http://localhost?view=meta-package&experimentVersionId=55&experimentHash=${'c'.repeat(64)}`), context);
    expect(response.status).toBe(422); expect((await response.json()).code).toBe('META_EXPERIMENT_PACKAGE_REJECTED'); expect(report).not.toHaveBeenCalled();
  });
  it('confirms an exact Meta package through the Admin tenant and session actor', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      operation: 'confirm-meta-package', experimentVersionId: 55, experimentHash: 'c'.repeat(64), controlCampaignId: 'c1', treatmentCampaignId: 'c2', packageFingerprint: 'd'.repeat(64), confirmedBy: 999,
    }) }), context);
    expect(response.status).toBe(201);
    expect(confirmPackage).toHaveBeenCalledWith('business-1', 12, expect.objectContaining({ experimentVersionId: 55, controlCampaignId: 'c1', treatmentCampaignId: 'c2', confirmedBy: 7 }));
    expect(create).not.toHaveBeenCalled();
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