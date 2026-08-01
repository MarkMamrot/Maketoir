import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_XERO_DOCUMENT_POLICY } from '@/lib/xero/documentPolicies';
import { autoPostShopifyPayout } from '../shopifyPayoutAutoPost';

function dependencies() {
  return {
    getPolicy: vi.fn().mockResolvedValue({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      shopifyPayoutAutoPostEnabled: true,
    }),
    mainQuery: vi.fn(),
    xeroFetch: vi.fn(),
    executeActions: vi.fn().mockResolvedValue({ status: 'reconciled', completedActionIds: [1] }),
    reportIssue: vi.fn().mockResolvedValue(1),
  };
}

describe('autoPostShopifyPayout', () => {
  let deps: ReturnType<typeof dependencies>;

  beforeEach(() => {
    deps = dependencies();
    deps.mainQuery
      .mockResolvedValueOnce([{ reconciliation_status: 'planned' }])
      .mockResolvedValueOnce([{ target_xero_document_id: 'invoice-1' }]);
  });

  it('authorises a linked Draft invoice before executing the payout plan', async () => {
    deps.xeroFetch.mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'invoice-1', Status: 'DRAFT' }] });

    const result = await autoPostShopifyPayout('biz-1', 'payout-1', deps);

    expect(result).toEqual({ status: 'reconciled' });
    expect(deps.xeroFetch).toHaveBeenNthCalledWith(2, 'biz-1', '/Invoices/invoice-1', {
      method: 'POST',
      body: { Invoices: [{ InvoiceID: 'invoice-1', Status: 'AUTHORISED' }] },
    });
    expect(deps.executeActions).toHaveBeenCalledWith('biz-1', 'payout-1');
  });

  it('does nothing when auto-post is disabled', async () => {
    deps.getPolicy.mockResolvedValue({ ...DEFAULT_XERO_DOCUMENT_POLICY });

    expect(await autoPostShopifyPayout('biz-1', 'payout-1', deps)).toEqual({ status: 'skipped_disabled' });
    expect(deps.mainQuery).not.toHaveBeenCalled();
  });

  it('does not execute a blocked or otherwise unplanned payout', async () => {
    deps.mainQuery.mockReset().mockResolvedValue([{ reconciliation_status: 'blocked' }]);

    expect(await autoPostShopifyPayout('biz-1', 'payout-1', deps)).toEqual({ status: 'skipped_not_planned' });
    expect(deps.executeActions).not.toHaveBeenCalled();
  });

  it('reports an executor failure without throwing into the webhook', async () => {
    deps.xeroFetch.mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'invoice-1', Status: 'AUTHORISED' }] });
    deps.executeActions.mockResolvedValue({ status: 'blocked', completedActionIds: [], error: 'Account mapping missing' });

    const result = await autoPostShopifyPayout('biz-1', 'payout-1', deps);

    expect(result).toEqual({ status: 'blocked', error: 'Account mapping missing' });
    expect(deps.reportIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      operation: 'shopify_payout_auto_post',
      reference: { type: 'shopify_payout', id: 'payout-1' },
    }));
  });
});