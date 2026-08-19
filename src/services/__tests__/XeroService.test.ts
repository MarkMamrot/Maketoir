import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnectionGet, mockConnectionUpsert, mockDecrypt, mockGetPolicy, mockEnsurePausedPolicy } = vi.hoisted(() => ({
  mockConnectionGet: vi.fn(),
  mockConnectionUpsert: vi.fn(),
  mockDecrypt: vi.fn((value: string) => value),
  mockGetPolicy: vi.fn(),
  mockEnsurePausedPolicy: vi.fn(),
}));

vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: { get: mockConnectionGet, upsert: mockConnectionUpsert },
}));
vi.mock('@/lib/encryption', () => ({ encrypt: vi.fn((value: string) => value), decrypt: mockDecrypt }));
vi.mock('@/lib/xero/documentPolicyRepository', () => ({
  ensurePausedXeroDocumentPolicy: mockEnsurePausedPolicy,
  getXeroDocumentPolicy: mockGetPolicy,
}));

import { XeroPostingDisabledError, saveXeroTokens, xeroApiFetch } from '../XeroService';

describe('xeroApiFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPolicy.mockResolvedValue({ postingEnabled: true });
    mockConnectionGet.mockResolvedValue({
      xero_access_token: 'access-token',
      xero_refresh_token: 'refresh-token',
      xero_tenant_id: 'tenant-1',
      xero_token_expiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ Payments: [] }),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('sends the stable idempotency key to Xero', async () => {
    await xeroApiFetch('biz-1', '/Payments', {
      method: 'POST',
      body: { Payments: [] },
      idempotencyKey: 'stable-action-key',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.xero.com/api.xro/2.0/Payments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'xero-tenant-id': 'tenant-1',
          'Idempotency-Key': 'stable-action-key',
        }),
      }),
    );
  });

  it('blocks writes before loading credentials or calling Xero when posting is paused', async () => {
    mockGetPolicy.mockResolvedValue({ postingEnabled: false });

    await expect(xeroApiFetch('biz-1', '/Payments', {
      method: 'POST',
      body: { Payments: [] },
    })).rejects.toBeInstanceOf(XeroPostingDisabledError);

    expect(mockConnectionGet).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows read-only Xero requests while posting is paused', async () => {
    mockGetPolicy.mockResolvedValue({ postingEnabled: false });

    await xeroApiFetch('biz-1', '/Accounts');

    expect(mockGetPolicy).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('starts a first-time Xero connection with posting paused', async () => {
    mockConnectionGet.mockResolvedValueOnce(null);

    await saveXeroTokens('biz-new', {
      access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer', scope: '',
    }, 'tenant-new', 'New Books');

    expect(mockConnectionUpsert).toHaveBeenCalledOnce();
    expect(mockEnsurePausedPolicy).toHaveBeenCalledWith('biz-new');
    expect(mockEnsurePausedPolicy.mock.invocationCallOrder[0]).toBeLessThan(mockConnectionUpsert.mock.invocationCallOrder[0]);
  });

  it('does not persist first-time credentials when the paused policy cannot be established', async () => {
    mockConnectionGet.mockResolvedValueOnce(null);
    mockEnsurePausedPolicy.mockRejectedValueOnce(new Error('policy unavailable'));

    await expect(saveXeroTokens('biz-new', {
      access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer', scope: '',
    }, 'tenant-new', 'New Books')).rejects.toThrow('policy unavailable');

    expect(mockConnectionUpsert).not.toHaveBeenCalled();
  });

  it('does not replace policy when reconnecting an existing Xero tenant', async () => {
    mockConnectionGet.mockResolvedValueOnce({ xero_tenant_id: 'tenant-existing' });

    await saveXeroTokens('biz-1', {
      access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer', scope: '',
    }, 'tenant-existing', 'Existing Books');

    expect(mockEnsurePausedPolicy).not.toHaveBeenCalled();
  });
});