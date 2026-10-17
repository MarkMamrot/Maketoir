import { describe, expect, it } from 'vitest';
import {
  assertShopifyReconciliationHistoryAccess, shopifyReconciliationPage, shopifyReconciliationParameters,
} from '../shopifyReconciliationPage';

const window = { phase: 'incremental' as const, from: '2026-10-17T00:00:00Z', to: '2026-10-17T01:00:00Z' };
const reference = { id: 123, created_at: '2026-07-01T00:00:00Z', updated_at: '2026-10-17T00:30:00Z' };

describe('Shopify reconciliation discovery', () => {
  it('bounds both ends by updated time, including old orders changed recently', () => {
    expect(shopifyReconciliationParameters(window, null)).toEqual({
      limit: 250, status: 'any', fields: 'id,created_at,updated_at',
      updated_at_min: '2026-10-17T00:00:00.000Z', updated_at_max: '2026-10-17T01:00:00.000Z',
    });
  });
  it('uses updated time for the initial recent catch-up and preserves opaque native cursors', () => {
    const initial = shopifyReconciliationParameters({ ...window, phase: 'baseline' }, null);
    expect(initial).toHaveProperty('updated_at_min', '2026-10-17T00:00:00.000Z');
    expect(initial).not.toHaveProperty('created_at_min');
    expect(shopifyReconciliationParameters(window, 'cursor==')).toEqual({
      limit: 250, page_info: 'cursor==', fields: 'id,created_at,updated_at',
    });
    expect(() => shopifyReconciliationParameters(window, 'https://other.example/')).toThrow();
  });
  it('returns only safe references and extracts the next native token', () => {
    const page = Object.assign([{ ...reference, email: 'not-persisted@example.test' }], {
      nextPageParameters: { page_info: 'next_cursor', limit: 250 },
    });
    expect(shopifyReconciliationPage(page)).toEqual({
      orders: [{ id: '123', updatedAt: '2026-10-17T00:30:00.000Z' }], nextPageInfo: 'next_cursor',
    });
  });
  it.each([
    null, {}, [null], [{ ...reference, id: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...reference, id: 0 }], [{ ...reference, updated_at: null }],
    [{ ...reference, created_at: '2026-02-30T00:00:00Z' }], [reference, reference],
    Array(251).fill(reference),
    Object.assign([reference], { nextPageParameters: {} }),
    Object.assign([reference], { nextPageParameters: { page_info: 'https://other.example/' } }),
  ])('rejects invalid data instead of declaring a partial page complete', page => {
    expect(() => shopifyReconciliationPage(page)).toThrow();
  });
  it('permits a genuine empty terminal page', () => {
    expect(shopifyReconciliationPage([])).toEqual({ orders: [], nextPageInfo: null });
  });
});

describe('Shopify historical access preflight', () => {
  const input = { baselineFrom: '2026-07-01T00:00:00Z', now: '2026-10-17T00:00:00Z', scopes: ['read_orders'] };
  it('blocks apparently successful but incomplete historical scans without read_all_orders', () => {
    expect(() => assertShopifyReconciliationHistoryAccess(input)).toThrow('read_all_orders');
    expect(() => assertShopifyReconciliationHistoryAccess({ ...input, scopes: ['read_orders', 'read_all_orders'] })).not.toThrow();
    expect(() => assertShopifyReconciliationHistoryAccess({ ...input, scopes: [] })).toThrow('order read access');
  });
  it('allows recent-history scans with normal read or write order access', () => {
    expect(() => assertShopifyReconciliationHistoryAccess({
      ...input, baselineFrom: '2026-10-01T00:00:00Z', scopes: ['write_orders'],
    })).not.toThrow();
  });
});
