import { describe, expect, it, vi } from 'vitest';

import { bootstrapHistoricalXeroTargets } from '../bootstrap';

describe('bootstrapHistoricalXeroTargets', () => {
  it('discovers each historical document family from independent cursors', async () => {
    const queryIms = vi.fn()
      .mockResolvedValueOnce([{ id: 11, xero_id: 'bill-11', total_amount: '110.00', currency_code: 'NZD' }])
      .mockResolvedValueOnce([{ id: 22, xero_id: 'invoice-22', total_amount: 55, currency_code: 'AUD' }])
      .mockResolvedValueOnce([{ id: 33, xero_id: 'credit-33', total_amount: 20, currency_code: 'AUD' }])
      .mockResolvedValueOnce([{ id: 44, xero_id: 'credit-44', total_amount: 30, currency_code: 'USD' }]);
    const insertTarget = vi.fn().mockResolvedValue(true);

    const result = await bootstrapHistoricalXeroTargets({
      businessId: 'biz-1',
      cursors: { purchaseOrder: 10, salesOrder: 20, customerCreditNote: 30, supplierCreditNote: 40 },
      limitPerType: 25,
    }, { queryIms: queryIms as any, insertTarget: insertTarget as any });

    expect(result).toEqual({
      discovered: 4, inserted: 4,
      cursors: { purchaseOrder: 11, salesOrder: 22, customerCreditNote: 33, supplierCreditNote: 44 },
    });
    expect(queryIms.mock.calls.map(call => call[1][1])).toEqual([10, 20, 30, 40]);
    expect(insertTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'purchase_order', referenceId: 11,
      expected: expect.objectContaining({
        xeroId: 'bill-11', documentType: 'ACCPAY', total: 110, currencyCode: 'NZD',
        status: null, compatibleStatuses: null, amountDue: null,
      }),
    }));
  });

  it('does not count an existing richer target as inserted', async () => {
    const queryIms = vi.fn()
      .mockResolvedValueOnce([{ id: 1, xero_id: 'bill-1', total_amount: 10, currency_code: 'AUD' }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const insertTarget = vi.fn().mockResolvedValue(false);

    const result = await bootstrapHistoricalXeroTargets(
      { businessId: 'biz-1' },
      { queryIms: queryIms as any, insertTarget: insertTarget as any },
    );

    expect(result.discovered).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.cursors.purchaseOrder).toBe(1);
  });
});