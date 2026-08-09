import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  imsQuery: vi.fn(),
  imsExecute: vi.fn(),
  getSalesOrder: vi.fn(),
  getPurchaseOrder: vi.fn(),
  allocate: vi.fn(),
  unallocate: vi.fn(),
  refund: vi.fn(),
  report: vi.fn(),
  xeroFetch: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsSORepo: { get: mocks.getSalesOrder },
  ImsPORepo: { get: mocks.getPurchaseOrder },
}));
vi.mock('@/services/XeroSyncService', () => ({
  allocateXeroCreditNote: mocks.allocate,
  deleteXeroCreditNoteAllocation: mocks.unallocate,
  refundXeroCreditNote: mocks.refund,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/services/XeroService', () => ({ xeroApiFetch: mocks.xeroFetch }));

import { POST } from '../route';

const context = { params: { type: 'customer', id: '7' } };
const request = (body: Record<string, unknown>) => new Request('http://localhost/api/ims/order-resolutions/customer/7/settlement', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const resolution = {
  id: 7,
  currency_code: 'AUD',
  credit_note_id: 21,
  credit_note_number: 'CN-21',
  xero_credit_note_id: 'xero-cn-21',
};

describe('order resolution settlement changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mocks.imsExecute.mockResolvedValue({ affectedRows: 1 });
    mocks.imsQuery.mockResolvedValueOnce([resolution]).mockResolvedValueOnce([]);
    mocks.xeroFetch.mockResolvedValue({ Accounts: [{ Code: '090', Status: 'ACTIVE', Type: 'BANK' }] });
  });

  it('blocks Advisor accounts before reading settlement data', async () => {
    mocks.getSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });

    const response = await POST(request({ action: 'unallocate' }), context);

    expect(response.status).toBe(403);
    expect(mocks.imsQuery).not.toHaveBeenCalled();
  });

  it('removes only the recorded successful allocation and releases its ledger row', async () => {
    mocks.imsQuery.mockReset();
    mocks.imsQuery.mockResolvedValueOnce([resolution]).mockResolvedValueOnce([{
      id: 31,
      action_type: 'reserve_for_order',
      status: 'succeeded',
      xero_id: 'allocation-31',
    }]);

    const response = await POST(request({ action: 'unallocate' }), context);

    expect(response.status).toBe(200);
    expect(mocks.unallocate).toHaveBeenCalledWith('biz-1', 'xero-cn-21', 'allocation-31');
    expect(mocks.imsExecute).toHaveBeenCalledWith(expect.stringContaining("status='released'"), [31, 'biz-1']);
  });

  it('records a new allocation action and uses the target order Xero invoice', async () => {
    mocks.getSalesOrder.mockResolvedValue({ id: 88, xero_invoice_id: 'invoice-88' });
    mocks.allocate.mockResolvedValue('allocation-88');

    const response = await POST(request({ action: 'allocate', amount: 20, targetOrderId: 88, operationKey: 'change-1' }), context);

    expect(response.status).toBe(200);
    expect(mocks.allocate).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', creditNoteId: 'xero-cn-21', invoiceId: 'invoice-88', amount: 20,
    }));
    expect(mocks.imsExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT IGNORE INTO ims_customer_credit_settlements'), expect.arrayContaining(['change-1:allocate']));
  });

  it('marks the durable action failed when Xero rejects a refund', async () => {
    mocks.refund.mockRejectedValue(new Error('Xero unavailable'));

    const response = await POST(request({ action: 'refund', amount: 10, accountCode: '090', operationKey: 'refund-1' }), context);

    expect(response.status).toBe(500);
    expect(mocks.imsExecute).toHaveBeenCalledWith(expect.stringContaining("status='failed'"), ['Xero unavailable', 'biz-1', 'refund-1:refund']);
    expect(mocks.report).toHaveBeenCalled();
  });
});
