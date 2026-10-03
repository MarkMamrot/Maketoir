import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  suggestions: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  release: vi.fn(),
}));

vi.mock('../stockAllocation/suggestionService', () => ({ loadStockAllocationSuggestions: mocks.suggestions }));
vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: () => ({ getConnection: vi.fn(async () => ({ query: mocks.query, execute: mocks.execute, release: mocks.release })) }),
}));

import { notifyStockAllocationSuggestionsForPurchaseOrder } from '../stockAllocation/suggestionNotifications';

describe('notifyStockAllocationSuggestionsForPurchaseOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('FROM ims_notifications')) return [[]];
      return [[]];
    });
    mocks.execute.mockResolvedValue([{ insertId: 1 }]);
  });

  it('creates one deep-linked notice for current suggestions on the purchase order', async () => {
    mocks.suggestions.mockResolvedValue([
      { poId: 20, poItemId: 21, soId: 10, soItemId: 11, quantity: 4 },
      { poId: 20, poItemId: 21, soId: 12, soItemId: 13, quantity: 2 },
      { poId: 30, poItemId: 31, soId: 14, soItemId: 15, quantity: 1 },
    ]);

    await expect(notifyStockAllocationSuggestionsForPurchaseOrder({
      businessId: 'biz-1', poId: 20, poNumber: 'PO-20',
    })).resolves.toBe(true);

    const insertParams = mocks.execute.mock.calls[0][1];
    expect(insertParams[2]).toContain('6 free incoming units');
    expect(JSON.parse(insertParams[3])).toMatchObject({
      action: 'open_stock_allocation', po_id: 20, suggestion_count: 2,
      sales_order_count: 2, suggested_quantity: 6,
    });
  });

  it('does not notify when the same suggestion signature already exists', async () => {
    mocks.suggestions.mockResolvedValue([{ poId: 20, poItemId: 21, soId: 10, soItemId: 11, quantity: 4 }]);
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('FROM ims_notifications')) return [[{ id: 9 }]];
      return [[]];
    });

    await expect(notifyStockAllocationSuggestionsForPurchaseOrder({ businessId: 'biz-1', poId: 20 })).resolves.toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});