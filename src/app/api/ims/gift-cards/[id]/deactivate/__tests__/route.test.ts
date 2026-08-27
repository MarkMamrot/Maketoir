import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getImsSession: vi.fn(),
  execute: vi.fn(),
  release: vi.fn(),
  disableGiftCard: vi.fn(),
  getProvider: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: () => ({ getConnection: async () => ({
    execute: mocks.execute,
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: mocks.release,
  }) }),
}));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mocks.getProvider } }));
vi.mock('@/lib/encryption', () => ({ decrypt: vi.fn(value => value) }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));
vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: class { disableGiftCard = mocks.disableGiftCard; },
}));

import { POST } from '../route';

describe('gift-card deactivation route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImsSession.mockResolvedValue({ businessId: 'business-1', tier: 'Manager' });
  });

  it('returns an existing command before making another irreversible provider call', async () => {
    mocks.execute.mockResolvedValueOnce([[{ id: 44, card_id: 7 }]]);
    const request = new Request('https://solvantis.com.au/api/ims/gift-cards/7/deactivate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Customer request', expected_balance: 25, idempotency_key: 'deactivate-7' }),
    });

    const response = await POST(request, { params: { id: '7' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, duplicate: true, transactionId: 44 });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.disableGiftCard).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});