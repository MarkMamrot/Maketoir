import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), findById: vi.fn() }));

vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/db/UsersRepository', () => ({ UsersRepository: { findById: mocks.findById } }));

import { getAccessibleBusinesses, INTERNAL_PLATFORM_BUSINESS_ID } from '../businessAccess';

const actor = {
  id: 7,
  business_id: 'home',
  tier: 'SuperAdmin',
} as any;

describe('SuperAdmin business access', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists every active real business for a SuperAdmin', async () => {
    mocks.query.mockResolvedValue([
      { business_id: 'alpha', name: 'Alpha', drive_folder_id: 'folder-alpha', has_foresight: 1, has_ims: 1, has_pos: 0, is_sandbox: 0 },
      { business_id: 'beta', name: 'Beta', drive_folder_id: null, has_foresight: 0, has_ims: 1, has_pos: 1, is_sandbox: 1 },
    ]);

    await expect(getAccessibleBusinesses(actor)).resolves.toEqual([
      { businessId: 'alpha', name: 'Alpha', driveFolderId: 'folder-alpha', hasForesight: true, hasIms: true, hasPos: false, isSandbox: false, tier: 'SuperAdmin' },
      { businessId: 'beta', name: 'Beta', driveFolderId: null, hasForesight: false, hasIms: true, hasPos: true, isSandbox: true, tier: 'SuperAdmin' },
    ]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('business_id <> ?'), [INTERNAL_PLATFORM_BUSINESS_ID]);
  });

  it('keeps ordinary users restricted to their assigned business', async () => {
    mocks.query.mockResolvedValue([{ business_id: 'home', name: 'Home', drive_folder_id: null, has_foresight: 0, has_ims: 1, has_pos: 1, is_sandbox: 0, membership_tier: 'Advisor' }]);

    await expect(getAccessibleBusinesses({ ...actor, tier: 'Admin' })).resolves.toEqual([
      expect.objectContaining({ businessId: 'home', tier: 'Advisor' }),
    ]);

    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('user_business_memberships'), [7, INTERNAL_PLATFORM_BUSINESS_ID]);
  });
});