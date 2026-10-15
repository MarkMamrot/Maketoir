import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireSession, mockGetConnection, mockReadAccount, mockAvailability } = vi.hoisted(() => ({
  mockRequireSession: vi.fn(), mockGetConnection: vi.fn(), mockReadAccount: vi.fn(), mockAvailability: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mockRequireSession }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mockGetConnection } }));
vi.mock('@/lib/encryption', () => ({ decrypt: (value: string) => `decrypted:${value}` }));
vi.mock('@/services/MetaOAuthService', () => ({
  metaOAuthConfigurationStatus: () => ({ configured: true, appIdPresent: true, appSecretPresent: true }),
  readMetaAdAccount: mockReadAccount,
}));
vi.mock('@/lib/ims/integrationAvailability', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ims/integrationAvailability')>(),
  assertOptionalIntegrationEnabled: mockAvailability,
}));

import { IntegrationDisabledError } from '@/lib/ims/integrationAvailability';
import { GET, POST } from '../route';

describe('/api/meta/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockReturnValue({ user: { businessId: 'business-1' } });
    mockAvailability.mockResolvedValue(undefined);
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
    expect(mockAvailability).toHaveBeenCalledWith('business-1', 'meta');
    expect(mockGetConnection).toHaveBeenCalledWith('business-1');
    expect(mockReadAccount).toHaveBeenCalledWith('decrypted:encrypted-token', '123');
  });

  it('fails closed without a stored tenant connection', async () => {
    mockGetConnection.mockResolvedValue(null);
    const response = await POST();
    expect(response.status).toBe(409);
    expect(mockReadAccount).not.toHaveBeenCalled();
  });

  it('blocks disabled integrations before reading credentials or calling the provider', async () => {
    mockAvailability.mockRejectedValue(new IntegrationDisabledError('meta'));
    const response = await POST();
    expect(response.status).toBe(423);
    expect(await response.json()).toEqual({
      success: false, error: 'meta integration is disabled for this business.', code: 'integration_disabled',
    });
    expect(mockGetConnection).not.toHaveBeenCalled();
    expect(mockReadAccount).not.toHaveBeenCalled();
  });

  it('fails closed when availability cannot be verified without exposing internal errors', async () => {
    mockAvailability.mockRejectedValue(new Error('Private availability diagnostic'));
    const response = await POST();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false, error: 'Meta integration availability is not ready.',
    });
    expect(mockGetConnection).not.toHaveBeenCalled();
    expect(mockReadAccount).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated connection tests before checking availability', async () => {
    mockRequireSession.mockReturnValue({ response: new Response(null, { status: 401 }) });
    expect((await POST()).status).toBe(401);
    expect(mockAvailability).not.toHaveBeenCalled();
    expect(mockGetConnection).not.toHaveBeenCalled();
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