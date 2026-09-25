import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  imsQuery: vi.fn(),
  imsExecute: vi.fn(),
  getImsSession: vi.fn(),
  giftCardDebit: vi.fn(),
  xeroSync: vi.fn(),
  getShopifyOperationContext: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => name === 'pos_session'
      ? { value: JSON.stringify({ businessId: 'business-1', location_id: 3 }) }
      : undefined,
  }),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getImsSession }));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mocks.getShopifyOperationContext }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: vi.fn() } }));
vi.mock('@/lib/encryption', () => ({ decrypt: vi.fn(value => value) }));
vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: class {
    giftCardDebit = mocks.giftCardDebit;
  },
}));
vi.mock('@/services/XeroSyncService', () => ({ syncGiftCardRedemptionReclass: mocks.xeroSync }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));

import { POST } from '../route';

describe('POS gift-card redemption route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImsSession.mockResolvedValue({ businessId: 'business-1' });
  });

  it('returns an existing sale redemption before repeating any mutations', async () => {
    mocks.imsQuery
      .mockResolvedValueOnce([{
        id: 7, balance: '90.00', status: 'active', shopify_gc_id: 100,
        channel_instance_id: 'shopify-store-1',
      }])
      .mockResolvedValueOnce([{ balance_after: '90.00', sync_state: 'synced' }]);
    const request = new Request('https://solvantis.com.au/api/pos/gift-card/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'CARD-1234', amount: 10, pos_sale_id: 55 }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, duplicate: true, balance_after: 90, shopify_synced: true });
    expect(mocks.giftCardDebit).not.toHaveBeenCalled();
    expect(mocks.imsExecute).not.toHaveBeenCalled();
    expect(mocks.xeroSync).not.toHaveBeenCalled();
  });

  it('blocks a provider-backed legacy card with no exact store owner', async () => {
    mocks.imsQuery.mockResolvedValueOnce([{
      id: 7, balance: '90.00', status: 'active', shopify_gc_id: 100, channel_instance_id: null,
    }]);
    const request = new Request('https://solvantis.com.au/api/pos/gift-card/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'CARD-1234', amount: 10, pos_sale_id: 55 }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain('no store owner');
    expect(mocks.giftCardDebit).not.toHaveBeenCalled();
    expect(mocks.imsExecute).not.toHaveBeenCalled();
  });

  it('blocks a code that resolves to multiple active cards', async () => {
    mocks.imsQuery.mockResolvedValueOnce([
      { id: 7, balance: '90.00', status: 'active', shopify_gc_id: 100, channel_instance_id: 'shopify-store-1' },
      { id: 8, balance: '25.00', status: 'active', shopify_gc_id: 100, channel_instance_id: 'shopify-store-2' },
    ]);
    const request = new Request('https://solvantis.com.au/api/pos/gift-card/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'CARD-1234', amount: 10, pos_sale_id: 55 }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain('multiple active gift cards');
    expect(mocks.giftCardDebit).not.toHaveBeenCalled();
    expect(mocks.imsExecute).not.toHaveBeenCalled();
  });

  it('uses an explicit store to disambiguate duplicate active codes', async () => {
    mocks.imsQuery
      .mockResolvedValueOnce([
        { id: 7, balance: '90.00', status: 'active', shopify_gc_id: 100, channel_instance_id: 'shopify-store-1' },
        { id: 8, balance: '25.00', status: 'active', shopify_gc_id: 100, channel_instance_id: 'shopify-store-2' },
      ])
      .mockResolvedValueOnce([{ balance_after: '25.00', sync_state: 'synced' }]);
    const request = new Request('https://solvantis.com.au/api/pos/gift-card/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'CARD-1234', amount: 10, pos_sale_id: 55, channelInstanceId: 'shopify-store-2',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.imsQuery.mock.calls[1][1]).toEqual(['pos-gift-card-redeem:55:8']);
    expect(mocks.giftCardDebit).not.toHaveBeenCalled();
  });
});