import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ imsQuery: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));

import { isKlaviyoTenantSchemaReady } from '../schemaReadiness';

describe('isKlaviyoTenantSchemaReady', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires both Klaviyo tenant tables', async () => {
    mocks.imsQuery.mockResolvedValue([
      { table_name: 'ims_klaviyo_profile_mappings' },
      { table_name: 'ims_klaviyo_outbox' },
    ]);

    await expect(isKlaviyoTenantSchemaReady()).resolves.toBe(true);
    expect(mocks.imsQuery).toHaveBeenCalledWith(expect.stringContaining('TABLE_SCHEMA = DATABASE()'), [
      'ims_klaviyo_profile_mappings',
      'ims_klaviyo_outbox',
    ]);
  });

  it('fails closed when either table is absent', async () => {
    mocks.imsQuery.mockResolvedValue([{ table_name: 'ims_klaviyo_outbox' }]);

    await expect(isKlaviyoTenantSchemaReady()).resolves.toBe(false);
  });
});