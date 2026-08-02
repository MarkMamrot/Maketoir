import { beforeEach, describe, expect, it, vi } from 'vitest';
const { buildPackage, getConfirmation, createConfirmation } = vi.hoisted(() => ({ buildPackage: vi.fn(), getConfirmation: vi.fn(), createConfirmation: vi.fn() }));
vi.mock('../metaExperimentLaunchPackage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../metaExperimentLaunchPackage')>();
  return { ...actual, buildMetaExperimentLaunchPackage: buildPackage };
});
vi.mock('../repositories/ForesightMetaExperimentLaunchPackageRepository', () => ({
  ForesightMetaExperimentLaunchPackageRepository: { getForThread: getConfirmation, create: createConfirmation },
}));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: vi.fn() } }));
vi.mock('../repositories/ForesightCampaignExperimentRepository', () => ({ ForesightCampaignExperimentRepository: { latest: vi.fn(), latestReview: vi.fn() } }));
import { ForesightMetaExperimentLaunchPackageService, MetaExperimentLaunchPackageValidationError } from '../ForesightMetaExperimentLaunchPackageService';

describe('ForesightMetaExperimentLaunchPackageService.confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks(); getConfirmation.mockResolvedValue(null); createConfirmation.mockResolvedValue({ id: 9 });
    vi.spyOn(ForesightMetaExperimentLaunchPackageService, 'build').mockResolvedValue({
      ready: true, confirmationFingerprint: 'f'.repeat(64), accountId: '123',
    } as never);
  });

  it('rejects a stale browser fingerprint before persistence', async () => {
    await expect(ForesightMetaExperimentLaunchPackageService.confirm('business-1', 12, {
      experimentVersionId: 7, experimentHash: 'a'.repeat(64), controlCampaignId: 'c1', treatmentCampaignId: 'c2',
      packageFingerprint: 'b'.repeat(64), confirmedBy: 5,
    })).rejects.toBeInstanceOf(MetaExperimentLaunchPackageValidationError);
    expect(createConfirmation).not.toHaveBeenCalled();
  });

  it('returns an existing exact confirmation without another insert', async () => {
    const existing = { experiment_version_id: 7, package_fingerprint: 'f'.repeat(64) };
    getConfirmation.mockResolvedValue(existing);
    await expect(ForesightMetaExperimentLaunchPackageService.confirm('business-1', 12, {
      experimentVersionId: 7, experimentHash: 'a'.repeat(64), controlCampaignId: 'c1', treatmentCampaignId: 'c2',
      packageFingerprint: 'f'.repeat(64), confirmedBy: 5,
    })).resolves.toBe(existing);
    expect(createConfirmation).not.toHaveBeenCalled();
  });
});
