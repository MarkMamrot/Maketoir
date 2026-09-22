import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  upsertBusinessInfo: vi.fn(),
  provisionIms: vi.fn(),
  enrollUserInBusiness: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({
  execute: mocks.execute,
}));
vi.mock('@/lib/db/BusinessInfoRepository', () => ({
  BusinessInfoRepository: { upsert: mocks.upsertBusinessInfo },
}));
vi.mock('@/lib/ims/provisionBusiness', () => ({
  cleanupFailedBusinessProvision: vi.fn(),
  ImsProvisioningError: class extends Error {},
  provisionBusinessIms: mocks.provisionIms,
}));
vi.mock('@/lib/auth/businessMemberships', () => ({
  enrollUserInBusiness: mocks.enrollUserInBusiness,
}));

import { provisionApprovedBusiness } from '../provisionApprovedBusiness';

describe('provisionApprovedBusiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ insertId: 1, affectedRows: 1 });
    mocks.upsertBusinessInfo.mockResolvedValue();
    mocks.provisionIms.mockResolvedValue({ imsDbName: 'readyedu_AcmeIMS', schemaCreated: true });
    mocks.enrollUserInBusiness.mockResolvedValue();
  });

  it('retains the approved business name, ABN and contact phone in the live business profile', async () => {
    const result = await provisionApprovedBusiness({
      businessName: 'Acme Retail',
      applicantUserId: 42,
      contactPhone: '0400 123 456',
      abn: '51824753556',
      hasForesight: true,
      hasIms: false,
      hasPos: true,
      aiPlanKey: 'starter',
      maxLocations: null,
      maxUsers: null,
      costPerLocation: null,
    });

    expect(result.businessId).toMatch(/^biz_/);
    expect(mocks.upsertBusinessInfo).toHaveBeenCalledWith(
      expect.stringMatching(/^biz_/),
      expect.objectContaining({
        brand_name: 'Acme Retail',
        phone: '0400 123 456',
        abn: '51824753556',
      }),
    );
  });
});
