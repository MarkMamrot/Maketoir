import { describe, expect, it } from 'vitest';

import { amazonReturnEventId, parseAmazonReturnsReport } from '../amazonReturnReport';

describe('Amazon returns report', () => {
  it('parses documented return fields and quoted tab-delimited values', () => {
    const report = [
      'Order ID\tReturn request date\tReturn request status\tAmazon RMA ID\tCurrency code\tASIN\tMerchant SKU\tItem Name\tReturn quantity\tReturn Reason\tReturn type\tResolution\tReturn delivery date\tRefunded Amount',
      '111-2222222-3333333\t2026-09-14T01:02:03Z\tCompleted\tRMA-1\tAUD\tB001\tSKU-1\t"Shirt\tBlue"\t2\tToo small\tCustomer return\tRefund\t2026-09-15T02:03:04Z\t-43.50',
    ].join('\n');
    const rows = parseAmazonReturnsReport(report);
    expect(rows).toEqual([expect.objectContaining({
      amazonOrderId: '111-2222222-3333333', amazonRmaId: 'RMA-1', merchantSku: 'SKU-1',
      itemName: 'Shirt\tBlue', quantity: 2, refundedAmount: 43.5, currencyCode: 'AUD',
      deliveredAt: '2026-09-15T02:03:04Z',
    })]);
    expect(amazonReturnEventId(rows[0])).toBe('return:111-2222222-3333333:RMA-1:SKU-1');
  });

  it('skips rows that cannot identify a concrete return quantity', () => {
    expect(parseAmazonReturnsReport([
      'Order ID\tReturn request date\tReturn request status\tAmazon RMA ID\tMerchant SKU\tReturn quantity',
      '111\t2026-09-14\tCompleted\tRMA-1\tSKU-1\t0',
    ].join('\n'))).toEqual([]);
  });
});