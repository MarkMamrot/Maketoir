import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopifyService } from '../ShopifyService';

const mock = vi.hoisted(() => {
  const options: unknown[] = [];
  return { options, list: vi.fn(), get: vi.fn(), scopes: vi.fn() };
});
vi.mock('shopify-api-node', () => ({
  default: class {
    constructor(options: unknown) { mock.options.push(options); }
    order = { list: mock.list, get: mock.get };
    accessScope = { list: mock.scopes };
  },
}));

const window = { phase: 'incremental' as const, from: '2026-10-17T00:00:00Z', to: '2026-10-17T01:00:00Z' };
const order = {
  id: 123, created_at: '2026-07-01T00:00:00Z', updated_at: '2026-10-17T00:30:00Z',
  line_items: [], refunds: [], fulfillments: [],
};
const service = () => new ShopifyService('example.myshopify.com', 'fixture-token');

beforeEach(() => {
  vi.clearAllMocks();
  mock.options.length = 0;
  mock.list.mockResolvedValue([order]);
  mock.get.mockResolvedValue(order);
  mock.scopes.mockResolvedValue([{ handle: 'read_orders' }, { handle: 'read_all_orders' }]);
});

describe('ShopifyService bounded recovery transport', () => {
  it('fetches one bounded page with a finite timeout and no hidden SDK retries', async () => {
    const client = service();
    expect(await client.getOrderReconciliationPage(window, null)).toEqual({
      orders: [{ id: '123', updatedAt: '2026-10-17T00:30:00.000Z' }], nextPageInfo: null,
    });
    expect(mock.list).toHaveBeenCalledTimes(1);
    expect(mock.list).toHaveBeenCalledWith(expect.objectContaining({
      updated_at_min: '2026-10-17T00:00:00.000Z', updated_at_max: '2026-10-17T01:00:00.000Z',
    }));
    expect(mock.options[0]).toEqual({ shopName: 'example.myshopify.com', accessToken: 'fixture-token' });
    expect(mock.options[1]).toMatchObject({ timeout: 10_000, maxRetries: 0 });
  });
  it('preserves native pagination and does not fetch all pages inside one call', async () => {
    mock.list.mockResolvedValue(Object.assign([order], { nextPageParameters: { page_info: 'next' } }));
    expect(await service().getOrderReconciliationPage(window, 'current')).toHaveProperty('nextPageInfo', 'next');
    expect(mock.list).toHaveBeenCalledExactlyOnceWith({ limit: 250, fields: 'id,created_at,updated_at', page_info: 'current' });
  });
  it('fetches the complete authoritative order, not a lightweight discovery row', async () => {
    expect(await service().getOrderForReconciliation('123')).toEqual(order);
    expect(mock.get).toHaveBeenCalledWith(123);
    mock.get.mockResolvedValue({ ...order, refunds: undefined });
    await expect(service().getOrderForReconciliation('123')).rejects.toThrow('incomplete reconciliation order');
  });
  it('rejects unsafe or mismatched IDs before any effect can use them', async () => {
    const client = service();
    await expect(client.getOrderForReconciliation('9007199254740993')).rejects.toThrow('safely representable');
    await expect(client.getOrderForReconciliation('00123')).rejects.toThrow('safely representable');
    expect(mock.get).not.toHaveBeenCalled();
    mock.get.mockResolvedValue({ ...order, id: 124 });
    await expect(client.getOrderForReconciliation('123')).rejects.toThrow('incomplete reconciliation order');
  });
  it('verifies historical access explicitly and does not hide scope or provider failures', async () => {
    const client = service();
    await expect(client.verifyOrderReconciliationHistoryAccess('2026-07-01T00:00:00Z', '2026-10-17T00:00:00Z')).resolves.toBeUndefined();
    mock.scopes.mockResolvedValue([{ handle: 'read_orders' }]);
    await expect(client.verifyOrderReconciliationHistoryAccess('2026-07-01T00:00:00Z', '2026-10-17T00:00:00Z')).rejects.toThrow('read_all_orders');
    mock.list.mockRejectedValue(new Error('provider unavailable'));
    await expect(client.getOrderReconciliationPage(window, null)).rejects.toThrow('provider unavailable');
  });
  it('rejects invalid bounds before contacting Shopify', async () => {
    const client = service();
    await expect(client.getOrderReconciliationPage({ ...window, to: window.from }, null)).rejects.toThrow('precede');
    await expect(client.verifyOrderReconciliationHistoryAccess('not-a-date', window.to)).rejects.toThrow('ISO timestamp');
    expect(mock.list).not.toHaveBeenCalled();
    expect(mock.scopes).not.toHaveBeenCalled();
  });
});
