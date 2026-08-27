import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getImsSession: vi.fn(),
  imsQuery: vi.fn(),
  imsExecute: vi.fn(),
  getConnection: vi.fn(),
  getHistory: vi.fn(),
  giftCardCredit: vi.fn(),
  giftCardDebit: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mocks.getConnection } }));
vi.mock('@/lib/encryption', () => ({ decrypt: vi.fn(value => value) }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: class {
    getGiftCardTransactions = mocks.getHistory;
    giftCardCredit = mocks.giftCardCredit;
    giftCardDebit = mocks.giftCardDebit;
  },
}));

import { POST } from '../route';

describe('gift-card transaction retry route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImsSession.mockResolvedValue({ businessId: 'business-1', tier: 'Manager' });
    mocks.getConnection.mockResolvedValue({
      shopify_shop_id: 'example.myshopify.com',
      shopify_access_token: 'token',
    });
    mocks.imsExecute.mockResolvedValue({ affectedRows: 1 });
  });

  it('recovers an uncertain POS debit from provider history without debiting again', async () => {
    mocks.imsQuery.mockResolvedValue([{
      id: 44,
      card_id: 7,
      type: 'redeem',
      amount: '-10.00',
      event_source: 'pos',
      sync_state: 'error',
      pos_sale_id: 55,
      notes: 'Redeemed at POS',
      shopify_gc_id: '100',
      currency: 'AUD',
      card_balance: '90.00',
    }]);
    mocks.getHistory.mockResolvedValue({
      balance: 90,
      currency: 'AUD',
      updatedAt: '2026-08-27T01:00:00Z',
      enabled: true,
      deactivatedAt: null,
      transactions: [
        { id: 'credit-1', type: 'credit', amount: 100, currency: 'AUD', processedAt: '2026-08-26T01:00:00Z', note: 'Issued' },
        { id: 'debit-1', type: 'debit', amount: -10, currency: 'AUD', processedAt: '2026-08-27T01:00:00Z', note: 'Solvantis POS sale 55' },
      ],
    });

    const response = await POST(
      new Request('https://solvantis.com.au/api/ims/gift-cards/7/transactions/44/retry', { method: 'POST' }),
      { params: { id: '7', transactionId: '44' } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, recoveredFromHistory: true, providerBalance: 90 });
    expect(mocks.giftCardDebit).not.toHaveBeenCalled();
    expect(mocks.imsExecute).toHaveBeenCalledTimes(3);
    expect(mocks.imsExecute.mock.calls[1][1]).toEqual(['debit-1', '2026-08-27 01:00:00', 90, 44]);
  });
});