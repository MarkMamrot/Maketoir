import { describe, expect, it, vi } from 'vitest';

import { buildExpectedXeroDocumentSnapshot, recordExpectedXeroDocument } from '../expectedSnapshots';

describe('expected Xero document snapshots', () => {
  it('maps document type and compatible lifecycle while preferring returned Xero identity fields', () => {
    expect(buildExpectedXeroDocumentSnapshot({
      targetType: 'supplier_credit_note', xeroId: 'credit-1', total: 22,
      status: 'DRAFT', currencyCode: 'AUD',
      xeroDocument: { Status: 'AUTHORISED', CurrencyCode: 'NZD', Contact: { ContactID: 'contact-1' } },
    })).toMatchObject({
      xeroId: 'credit-1', documentType: 'ACCPAYCREDIT', contactId: 'contact-1',
      currencyCode: 'NZD', total: 22, status: 'AUTHORISED', compatibleStatuses: ['AUTHORISED', 'PAID'],
      amountDue: null, amountPaid: null, amountCredited: null, remainingCredit: null,
    });
  });

  it('persists a canonical expected snapshot without marking it checked', async () => {
    const upsertTarget = vi.fn().mockResolvedValue(4);
    await recordExpectedXeroDocument({
      businessId: 'biz-1', targetType: 'purchase_order', referenceId: 42,
      xeroId: 'bill-1', total: 110, status: 'DRAFT', currencyCode: 'aud',
    }, { getExpected: vi.fn().mockResolvedValue(null) as any, upsertTarget: upsertTarget as any });

    expect(upsertTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'purchase_order', xeroId: 'bill-1',
      expected: expect.objectContaining({ documentType: 'ACCPAY', currencyCode: 'AUD', compatibleStatuses: ['DRAFT', 'SUBMITTED'] }),
    }));
    expect(upsertTarget.mock.calls[0][0]).not.toHaveProperty('checked');
  });

  it('reports persistence failure without rejecting the successful sync path', async () => {
    const upsertTarget = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const reportIssue = vi.fn().mockResolvedValue(undefined);

    await expect(recordExpectedXeroDocument({
      businessId: 'biz-1', targetType: 'sales_order', referenceId: 8, xeroId: 'invoice-8', total: 55, status: 'DRAFT',
    }, {
      getExpected: vi.fn().mockResolvedValue(null) as any,
      upsertTarget: upsertTarget as any,
      reportIssue: reportIssue as any,
    })).resolves.toBeUndefined();
    expect(reportIssue).toHaveBeenCalledWith(expect.objectContaining({ operation: 'record_expected_snapshot' }));
  });

  it('preserves known financial identity when an approval response only returns status', async () => {
    const upsertTarget = vi.fn().mockResolvedValue(4);
    await recordExpectedXeroDocument({
      businessId: 'biz-1', targetType: 'sales_order', referenceId: 8,
      xeroId: 'invoice-8', status: 'AUTHORISED', xeroDocument: { Status: 'AUTHORISED' },
    }, {
      getExpected: vi.fn().mockResolvedValue(buildExpectedXeroDocumentSnapshot({
        targetType: 'sales_order', xeroId: 'invoice-8', total: 55, status: 'DRAFT',
        currencyCode: 'NZD', xeroDocument: { Contact: { ContactID: 'contact-8' } },
      })) as any,
      upsertTarget: upsertTarget as any,
    });

    expect(upsertTarget.mock.calls[0][0].expected).toMatchObject({
      total: 55, currencyCode: 'NZD', contactId: 'contact-8',
      status: 'AUTHORISED', compatibleStatuses: ['AUTHORISED', 'PAID'],
    });
  });
});