import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), decrypt: vi.fn(), refresh: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/encryption', () => ({ decrypt: mocks.decrypt }));
vi.mock('../amazonSpApi', () => ({ refreshAmazonAccessToken: mocks.refresh }));

import { getAmazonChannelAccess } from '../amazonCredentials';

describe('getAmazonChannelAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue([{ encrypted_payload: 'ciphertext', external_account_key: 'A1SELLER99' }]);
    mocks.decrypt.mockReturnValue(JSON.stringify({ refreshToken: 'refresh-secret', sellerId: 'A1SELLER99' }));
    mocks.refresh.mockResolvedValue({ accessToken: 'access-token', expiresIn: 3600 });
  });

  it('scopes credential lookup to the business and channel instance', async () => {
    await expect(getAmazonChannelAccess('business-1', 'instance-1')).resolves.toEqual({
      accessToken: 'access-token', sellerId: 'A1SELLER99',
    });
    expect(mocks.query.mock.calls[0][0]).toContain('instance.business_id = ? AND instance.channel_instance_id = ?');
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 'instance-1']);
    expect(mocks.refresh).toHaveBeenCalledWith('refresh-secret');
  });

  it('rejects a credential envelope for a different seller', async () => {
    mocks.decrypt.mockReturnValue(JSON.stringify({ refreshToken: 'refresh-secret', sellerId: 'OTHERSELLER' }));
    await expect(getAmazonChannelAccess('business-1', 'instance-1')).rejects.toThrow('credentials are invalid');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('returns null when the exact instance has no credential', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(getAmazonChannelAccess('business-1', 'instance-1')).resolves.toBeNull();
  });
});