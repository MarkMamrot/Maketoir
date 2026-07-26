import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPaidShopifyPayouts, ingestShopifyPayout } from '../shopifyPayoutIngestion';

const creds = { shopName: 'test', token: 'token', base: 'https://test.myshopify.com/admin/api/2024-10' };
const paidPayout = { id: 'payout-1', status: 'paid', date: '2026-07-25', currency: 'AUD', amount: '97.00' };

afterEach(() => vi.unstubAllGlobals());

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    mainQuery: vi.fn().mockResolvedValue([]),
    mainExecute: vi.fn().mockResolvedValue({ affectedRows: 1 }),
    fetchTransactions: vi.fn().mockResolvedValue([
      {
        id: 'transaction-1', type: 'charge', amount: '100.00', fee: '-3.00', net: '97.00',
        currency: 'AUD', source_order_id: 'order-1', processed_at: '2026-07-25T01:00:00Z',
      },
    ]),
    planActions: vi.fn().mockResolvedValue({ status: 'planned', actions: [] }),
    ...overrides,
  } as any;
}

describe('ingestShopifyPayout', () => {
  it.each(['planned', 'partial', 'reconciled'])('does not reset a %s payout', async reconciliationStatus => {
    const deps = dependencies({
      mainQuery: vi.fn().mockResolvedValue([{ reconciliation_status: reconciliationStatus }]),
    });

    const result = await ingestShopifyPayout('biz-1', paidPayout, creds, deps);

    expect(result.status).toBe(`skipped_${reconciliationStatus}`);
    expect(deps.mainExecute).not.toHaveBeenCalled();
    expect(deps.fetchTransactions).not.toHaveBeenCalled();
    expect(deps.planActions).not.toHaveBeenCalled();
  });

  it('persists matching transactions and plans the paid payout', async () => {
    const deps = dependencies();

    const result = await ingestShopifyPayout('biz-1', paidPayout, creds, deps);

    expect(result.status).toBe('planned');
    expect(deps.fetchTransactions).toHaveBeenCalledWith(creds, 'payout-1');
    expect(deps.planActions).toHaveBeenCalledWith('biz-1', 'payout-1');
    expect(deps.mainExecute.mock.calls.some((call: any[]) => String(call[0]).includes("reconciliation_status = 'ready_to_allocate'"))).toBe(true);
  });

  it('blocks a payout whose transaction net does not equal its amount', async () => {
    const deps = dependencies({
      fetchTransactions: vi.fn().mockResolvedValue([
        { id: 'transaction-1', type: 'charge', amount: '100.00', fee: '-4.00', net: '96.00', currency: 'AUD' },
      ]),
    });

    const result = await ingestShopifyPayout('biz-1', paidPayout, creds, deps);

    expect(result.status).toBe('blocked');
    expect(deps.planActions).not.toHaveBeenCalled();
    expect(deps.mainExecute.mock.calls.some((call: any[]) => (
      String(call[0]).includes("reconciliation_status = 'blocked'")
      && call[1][1] === 'Balance transaction net 96.00 does not equal payout 97.00'
    ))).toBe(true);
  });
});

describe('fetchPaidShopifyPayouts', () => {
  it('follows Shopify cursor pagination', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ payouts: [{ id: 'payout-1' }] }), {
        headers: { link: '<https://test.myshopify.com/next-page>; rel="next"' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ payouts: [{ id: 'payout-2' }] })));
    vi.stubGlobal('fetch', fetchMock);

    const payouts = await fetchPaidShopifyPayouts(creds, '2026-07-01');

    expect(payouts.map(payout => payout.id)).toEqual(['payout-1', 'payout-2']);
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://test.myshopify.com/next-page', expect.any(Object));
  });
});