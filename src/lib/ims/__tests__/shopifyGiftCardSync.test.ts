import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsExecute, mockImsQuery, mockReportRuntimeIssue } = vi.hoisted(() => ({
  mockImsExecute: vi.fn(),
  mockImsQuery: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: mockImsExecute, imsQuery: mockImsQuery }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { syncShopifyGiftCardSnapshots } from '../shopifyGiftCardSync';

describe('syncShopifyGiftCardSnapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImsExecute.mockResolvedValue({ insertId: 1 });
    mockReportRuntimeIssue.mockResolvedValue(null);
  });

  it('imports cards with colliding last characters under distinct placeholders', async () => {
    mockImsQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ shopify_gc_id: '100' }]);
    const shopify = {
      getAllGiftCards: vi.fn(async (status: 'enabled' | 'disabled') => status === 'enabled' ? [
        { id: 100, last_characters: '7215', balance: '10.00' },
        { id: 200, last_characters: '7215', balance: '20.00' },
      ] : []),
    };

    const result = await syncShopifyGiftCardSnapshots('business-1', shopify);

    expect(result).toMatchObject({ success: true, inserted: 2, synced: 2, errors: 0 });
    expect(mockImsExecute.mock.calls[0][1]).toContain('SHOPIFY:7215');
    expect(mockImsExecute.mock.calls[1][1]).toContain('SHOPIFY:ID:200');
  });

  it('marks an existing balance mismatch for review without overwriting the local balance', async () => {
    mockImsQuery.mockResolvedValueOnce([{ id: 7, balance: '15.00' }]);
    const shopify = {
      getAllGiftCards: vi.fn(async (status: 'enabled' | 'disabled') => status === 'enabled'
        ? [{ id: 100, last_characters: '7215', balance: '20.00' }]
        : []),
    };

    const result = await syncShopifyGiftCardSnapshots('business-1', shopify);

    expect(result.reviewRequired).toBe(1);
    expect(mockImsExecute.mock.calls[0][1][2]).toBe(0);
    expect(mockImsExecute.mock.calls[0][1]).toContain('review_required');
  });

  it('applies a provider debit when unseen history proves the full balance change', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ id: 7, balance: '100.00', shopify_observed_balance: '100.00' }])
      .mockResolvedValueOnce([{ shopify_transaction_id: 'credit-1' }]);
    const shopify = {
      getAllGiftCards: vi.fn(async (status: 'enabled' | 'disabled') => status === 'enabled'
        ? [{ id: 100, last_characters: '7215', balance: '95.00' }]
        : []),
      getGiftCardTransactions: vi.fn(async () => ({
        balance: 90,
        currency: 'AUD',
        updatedAt: '2026-08-27T01:00:00Z',
        enabled: true,
        deactivatedAt: null,
        transactions: [
          { id: 'credit-1', type: 'credit' as const, amount: 50, currency: 'AUD', processedAt: '2026-08-26T01:00:00Z', note: 'Earlier credit' },
          { id: 'debit-1', type: 'debit' as const, amount: -10, currency: 'AUD', processedAt: '2026-08-27T01:00:00Z', note: 'Used online' },
        ],
      })),
    };

    const result = await syncShopifyGiftCardSnapshots('business-1', shopify);

    expect(result).toMatchObject({ reviewRequired: 0, importedTransactions: 1 });
    expect(mockImsExecute.mock.calls[1][1][2]).toBe(1);
    expect(mockImsExecute.mock.calls[1][1][3]).toBe(90);
    expect(mockImsExecute.mock.calls[0][1]).toEqual([
      7, 'redeem', -10, 90, 'debit-1', '2026-08-27 01:00:00', 90, 'Used online',
    ]);
  });

  it('does not duplicate provider transactions already recorded locally', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ id: 7, balance: '90.00', shopify_observed_balance: '90.00' }])
      .mockResolvedValueOnce([{ shopify_transaction_id: 'credit-1' }, { shopify_transaction_id: 'debit-1' }]);
    const shopify = {
      getAllGiftCards: vi.fn(async (status: 'enabled' | 'disabled') => status === 'enabled'
        ? [{ id: 100, last_characters: '7215', balance: '90.00' }]
        : []),
      getGiftCardTransactions: vi.fn(async () => ({
        balance: 90, currency: 'AUD', updatedAt: '2026-08-27T01:00:00Z', enabled: true, deactivatedAt: null,
        transactions: [
          { id: 'credit-1', type: 'credit' as const, amount: 100, currency: 'AUD', processedAt: '2026-08-26T01:00:00Z', note: null },
          { id: 'debit-1', type: 'debit' as const, amount: -10, currency: 'AUD', processedAt: '2026-08-27T01:00:00Z', note: null },
        ],
      })),
    };

    const result = await syncShopifyGiftCardSnapshots('business-1', shopify);

    expect(result.importedTransactions).toBe(0);
    expect(mockImsExecute).toHaveBeenCalledTimes(1);
  });

  it('keeps a first-seen mismatch in review even when provider history is available', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ id: 7, balance: '15.00', shopify_observed_balance: null }])
      .mockResolvedValueOnce([]);
    const shopify = {
      getAllGiftCards: vi.fn(async (status: 'enabled' | 'disabled') => status === 'enabled'
        ? [{ id: 100, last_characters: '7215', balance: '20.00' }]
        : []),
      getGiftCardTransactions: vi.fn(async () => ({
        balance: 20, currency: 'AUD', updatedAt: '2026-08-27T01:00:00Z', enabled: true, deactivatedAt: null,
        transactions: [{ id: 'credit-1', type: 'credit' as const, amount: 20, currency: 'AUD', processedAt: '2026-08-26T01:00:00Z', note: null }],
      })),
    };

    const result = await syncShopifyGiftCardSnapshots('business-1', shopify);

    expect(result).toMatchObject({ reviewRequired: 1, importedTransactions: 1 });
    expect(mockImsExecute.mock.calls[1][1][2]).toBe(0);
    expect(mockImsExecute.mock.calls[1][1]).toContain('review_required');
  });

  it('imports an unknown provider event without using it to authorize a balance change', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ id: 7, balance: '100.00', shopify_observed_balance: '100.00' }])
      .mockResolvedValueOnce([]);
    const shopify = {
      getAllGiftCards: vi.fn(async (status: 'enabled' | 'disabled') => status === 'enabled'
        ? [{ id: 100, last_characters: '7215', balance: '90.00' }]
        : []),
      getGiftCardTransactions: vi.fn(async () => ({
        balance: 90, currency: 'AUD', updatedAt: '2026-08-27T01:00:00Z', enabled: true, deactivatedAt: null,
        transactions: [{ id: 'other-1', type: 'unknown' as const, amount: -10, currency: 'AUD', processedAt: '2026-08-27T01:00:00Z', note: null }],
      })),
    };

    const result = await syncShopifyGiftCardSnapshots('business-1', shopify);

    expect(result).toMatchObject({ reviewRequired: 1, importedTransactions: 1 });
    expect(mockImsExecute.mock.calls[1][1][2]).toBe(0);
    expect(mockImsExecute.mock.calls[0][1][1]).toBe('reconcile');
  });

  it('skips transaction history when the matched Shopify update checkpoint is unchanged', async () => {
    mockImsQuery.mockResolvedValueOnce([{
      id: 7,
      balance: '90.00',
      shopify_observed_balance: '90.00',
      shopify_updated_at: '2026-08-27 01:00:00',
      reconciliation_state: 'matched',
    }]);
    const getGiftCardTransactions = vi.fn();
    const shopify = {
      getAllGiftCards: vi.fn(async (status: 'enabled' | 'disabled') => status === 'enabled'
        ? [{ id: 100, last_characters: '7215', balance: '90.00', updated_at: '2026-08-27T01:00:00Z' }]
        : []),
      getGiftCardTransactions,
    };

    const result = await syncShopifyGiftCardSnapshots('business-1', shopify);

    expect(result).toMatchObject({ synced: 1, importedTransactions: 0, reviewRequired: 0 });
    expect(getGiftCardTransactions).not.toHaveBeenCalled();
    expect(mockImsExecute).toHaveBeenCalledTimes(1);
  });

  it('continues snapshot reconciliation after reporting missing transaction-history scope once', async () => {
    mockImsQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const getGiftCardTransactions = vi.fn().mockRejectedValue(
      new Error('Shopify GraphQL: Access denied for nodes field. Required access: `read_gift_card_transactions` access scope.'),
    );
    const shopify = {
      getAllGiftCards: vi.fn(async (status: 'enabled' | 'disabled') => status === 'enabled' ? [
        { id: 100, last_characters: '7215', balance: '10.00', updated_at: '2026-08-27T01:00:00Z' },
        { id: 200, last_characters: '4848', balance: '20.00', updated_at: '2026-08-27T02:00:00Z' },
      ] : []),
      getGiftCardTransactions,
    };

    const result = await syncShopifyGiftCardSnapshots('business-1', shopify);

    expect(result).toMatchObject({ success: true, inserted: 2, errors: 0, transactionHistoryAvailable: false });
    expect(getGiftCardTransactions).toHaveBeenCalledTimes(1);
    expect(mockImsExecute.mock.calls[0][1]).toContain('2026-08-27 01:00:00');
    expect(mockImsExecute.mock.calls[1][1]).toContain('2026-08-27 02:00:00');
    expect(mockReportRuntimeIssue).toHaveBeenCalledTimes(1);
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'gift_card_transaction_history_scope',
    }));
  });
});