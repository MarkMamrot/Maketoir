import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireSession, mockGetConnection, mockReadAccount } = vi.hoisted(() => ({
  mockRequireSession: vi.fn(), mockGetConnection: vi.fn(), mockReadAccount: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mockRequireSession }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mockGetConnection } }));
vi.mock('@/lib/encryption', () => ({ decrypt: (value: string) => `decrypted:${value}` }));
vi.mock('@/services/MetaOAuthService', () => ({
  metaOAuthConfigurationStatus: () => ({ configured: true, appIdPresent: true, appSecretPresent: true }),
  readMetaAdAccount: mockReadAccount,
}));

import { GET, POST } from '../route';

describe('/api/meta/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockReturnValue({ user: { businessId: 'business-1' } });
  });

  it('reports connection state without returning a token', async () => {
    mockGetConnection.mockResolvedValue({ meta_ad_account_id: '123', meta_access_token: 'encrypted-token' });
    const response = await GET();
    expect(await response.json()).toEqual({
      configured: true, appIdPresent: true, appSecretPresent: true, connected: true, accountId: '123',
    });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  });

  it('tests only the signed-in tenant stored connection', async () => {
    mockGetConnection.mockResolvedValue({ meta_ad_account_id: '123', meta_access_token: 'encrypted-token' });
    mockReadAccount.mockResolvedValue({ accountId: '123', name: 'Retail AU' });
    const response = await POST();
    expect(response.status).toBe(200);
    expect(mockGetConnection).toHaveBeenCalledWith('business-1');
    expect(mockReadAccount).toHaveBeenCalledWith('decrypted:encrypted-token', '123');
  });

  it('fails closed without a stored tenant connection', async () => {
    mockGetConnection.mockResolvedValue(null);
    const response = await POST();
    expect(response.status).toBe(409);
    expect(mockReadAccount).not.toHaveBeenCalled();
  });

  it('still reports runtime configuration when the connection lookup fails', async () => {
    mockGetConnection.mockRejectedValue(new Error('Database unavailable'));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: true,
      appIdPresent: true,
      appSecretPresent: true,
      connected: false,
      accountId: null,
      connectionError: 'Database unavailable',
    });
  });
});