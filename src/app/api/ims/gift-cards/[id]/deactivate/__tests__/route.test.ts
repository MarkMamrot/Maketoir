import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getImsSession: vi.fn(),
  execute: vi.fn(),
  release: vi.fn(),
  disableGiftCard: vi.fn(),
  getProvider: vi.fn(),
  getShopifyOperationContext: vi.fn(),
  getConnection: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), report: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getImsSession }));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mocks.getShopifyOperationContext }));
vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: () => ({ execute: mocks.execute, getConnection: mocks.getConnection }),
}));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mocks.getProvider } }));
vi.mock('@/lib/encryption', () => ({ decrypt: vi.fn(value => value) }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: class { disableGiftCard = mocks.disableGiftCard; },
}));

import { POST } from '../route';

describe('gift-card deactivation route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImsSession.mockResolvedValue({ businessId: 'business-1', tier: 'Manager' });
    mocks.getConnection.mockResolvedValue({
      execute: mocks.execute, beginTransaction: mocks.beginTransaction, commit: mocks.commit,
      rollback: mocks.rollback, release: mocks.release,
    });
    mocks.report.mockResolvedValue(null);
    mocks.getShopifyOperationContext.mockResolvedValue({
      credentials: { shopDomain: 'store-two.myshopify.com', token: 'store-two-token' },
    });
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
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it('uses the selected card owner for Shopify deactivation', async () => {
    mocks.execute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{
        balance: '25.00', status: 'active', shopify_gc_id: 100,
        channel_instance_id: 'shopify-store-2',
      }]])
      .mockResolvedValueOnce([[{
        balance: '25.00', status: 'active', shopify_gc_id: 100,
        channel_instance_id: 'shopify-store-2',
      }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 45 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    mocks.disableGiftCard.mockResolvedValue(undefined);
    const request = new Request('https://solvantis.com.au/api/ims/gift-cards/7/deactivate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Customer request', expected_balance: 25, idempotency_key: 'deactivate-7' }),
    });

    const response = await POST(request, { params: { id: '7' } });

    expect(response.status).toBe(200);
    expect(mocks.getShopifyOperationContext).toHaveBeenCalledWith({
      businessId: 'business-1',
      channelInstanceId: 'shopify-store-2',
    });
    expect(mocks.disableGiftCard).toHaveBeenCalledWith(100);
    expect(mocks.disableGiftCard.mock.invocationCallOrder[0]).toBeLessThan(mocks.getConnection.mock.invocationCallOrder[0]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('does not retain an IMS slot while the external deactivation is pending', async () => {
    const card = { balance: 25, status: 'active', shopify_gc_id: 100, channel_instance_id: 'shopify-store-2' };
    mocks.execute.mockImplementation(async (sql: string) => sql.includes('FROM gift_cards')
      ? [[card]] : sql.includes('FROM gift_card_transactions') ? [[]] : [{ insertId: 45, affectedRows: 1 }]);
    let finish!: () => void;
    mocks.disableGiftCard.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = POST(new Request('https://solvantis.com.au/api/ims/gift-cards/7/deactivate', {
      method: 'POST', body: JSON.stringify({ reason: 'Customer request', expected_balance: 25, idempotency_key: 'deactivate-7' }),
    }), { params: { id: '7' } });
    await vi.waitFor(() => expect(mocks.disableGiftCard).toHaveBeenCalledOnce());
    expect(mocks.getConnection).not.toHaveBeenCalled();
    finish();
    expect((await pending).status).toBe(200);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('rechecks local value under lock and surfaces changes after external deactivation', async () => {
    const card = { balance: 25, status: 'active', shopify_gc_id: 100, channel_instance_id: 'shopify-store-2' };
    mocks.execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[card]])
      .mockResolvedValueOnce([[{ ...card, balance: 26 }]]).mockResolvedValueOnce([[]]);
    mocks.disableGiftCard.mockResolvedValue(undefined);
    const response = await POST(new Request('https://solvantis.com.au/api/ims/gift-cards/7/deactivate', {
      method: 'POST', body: JSON.stringify({ reason: 'Customer request', expected_balance: 25, idempotency_key: 'deactivate-7' }),
    }), { params: { id: '7' } });
    expect(response.status).toBe(409);
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'gift_card_deactivate_reconcile' }));
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});