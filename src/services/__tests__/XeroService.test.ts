import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnectionGet, mockDecrypt } = vi.hoisted(() => ({
  mockConnectionGet: vi.fn(),
  mockDecrypt: vi.fn((value: string) => value),
}));

vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: { get: mockConnectionGet, upsert: vi.fn() },
}));
vi.mock('@/lib/encryption', () => ({ encrypt: vi.fn((value: string) => value), decrypt: mockDecrypt }));

import { xeroApiFetch } from '../XeroService';

describe('xeroApiFetch', () => {
  beforeEach(() => {
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
});