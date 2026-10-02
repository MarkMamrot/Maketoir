import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ xeroState: vi.fn(), report: vi.fn() }));

vi.mock('@/services/XeroSyncService', () => ({ getXeroInvoiceEditState: mocks.xeroState }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { preflightSalesOrderXeroDocuments } from '../orderTransfers/salesOrderXeroPreflight';

const document = { orderId: 17, orderNumber: 'SO-2026-0017', xeroDocumentId: 'invoice-17' };

describe('sales order Xero transfer preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.report.mockResolvedValue(1);
  });

  it('clears an unpaid Authorised invoice outside lock periods', async () => {
    mocks.xeroState.mockResolvedValue({
      status: 'AUTHORISED', amountPaid: 0, amountCredited: 0,
      documentDate: '2026-10-01', periodLockDate: '2026-08-31', endOfYearLockDate: '2026-06-30',
    });

    await expect(preflightSalesOrderXeroDocuments('biz-1', [document])).resolves.toEqual({
      17: { documentId: 'invoice-17', status: 'AUTHORISED', editable: true, conflict: null },
    });
  });

  it('blocks a settled invoice with the policy reason', async () => {
    mocks.xeroState.mockResolvedValue({
      status: 'AUTHORISED', amountPaid: 10, amountCredited: 0,
      documentDate: '2026-10-01', periodLockDate: null, endOfYearLockDate: null,
    });

    const result = await preflightSalesOrderXeroDocuments('biz-1', [document]);
    expect(result[17]).toMatchObject({ editable: false, conflict: 'The linked Xero document has payments or credits applied.' });
  });

  it('fails closed and reports an unverifiable invoice', async () => {
    mocks.xeroState.mockRejectedValue(new Error('Xero unavailable'));

    const result = await preflightSalesOrderXeroDocuments('biz-1', [document]);
    expect(result[17]).toMatchObject({ status: 'UNKNOWN', editable: false });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', operation: 'xero_transfer_preflight',
      reference: { type: 'sales_order', id: '17' },
    }));
  });
});