import { describe, expect, it } from 'vitest';

import { listHelpTopics, resolveHelpContext } from '../resolveHelpContext';

describe('resolveHelpContext', () => {
  it('opens Purchase Orders for its IMS view and child workflows', () => {
    for (const context of ['purchase-orders', 'purchase-order-detail', 'purchase-order-receive']) {
      expect(resolveHelpContext({ audience: 'ims', product: 'ims', context })).toEqual(expect.objectContaining({
        exact: true,
        topic: expect.objectContaining({ id: 'ims-purchase-orders' }),
      }));
    }
  });

  it('opens POS EOD and Xero help from the EOD screen', () => {
    expect(resolveHelpContext({ audience: 'pos', product: 'pos', context: 'eod' })).toEqual(expect.objectContaining({
      exact: true,
      topic: expect.objectContaining({ id: 'pos-end-of-day-xero' }),
    }));
  });

  it('never returns IMS-only topics to wholesale users', () => {
    expect(listHelpTopics('wholesale').every(topic => topic.audiences.includes('wholesale'))).toBe(true);
    expect(resolveHelpContext({ audience: 'wholesale', product: 'ims', context: 'purchase-orders' })).toBeNull();
  });
});