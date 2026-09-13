import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  getOrder: vi.fn(),
  split: vi.fn(),
  report: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsSORepo: { get: mocks.getOrder } }));
vi.mock('@/lib/ims/backorders/customerBackorders', () => ({ splitCustomerBackorder: mocks.split }));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: vi.fn() }));
vi.mock('@/lib/ims/xeroHooks', () => ({ triggerSOXeroSync: vi.fn() }));
vi.mock('@/services/XeroSyncService', () => ({ getXeroInvoiceStatus: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { FifoCostingConflict } from '@/lib/ims/costing/fifoCostingService';
import { POST } from '../route';

function request(body: unknown): Request {
  return new Request('http://localhost/api/ims/sales-orders/42/backorder', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST sales order backorder split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.getOrder.mockResolvedValue({ id: 42, xero_invoice_id: null });
  });

  it('returns FIFO reconciliation conflicts without reporting an operational issue', async () => {
    mocks.split.mockRejectedValue(new FifoCostingConflict(
      'Cannot complete this stock movement: reconcile the missing 1 FIFO unit before retrying.',
    ));

    const response = await POST(request({
      operationKey: 'split-fifo-short',
      fulfilQuantities: [{ itemId: 10, quantity: 2 }],
      allowNegativeStock: true,
    }), { params: { id: '42' } });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'FIFO_COSTING_CONFLICT',
      error: expect.stringContaining('reconcile the missing 1 FIFO unit'),
    });
    expect(mocks.report).not.toHaveBeenCalled();
  });
});