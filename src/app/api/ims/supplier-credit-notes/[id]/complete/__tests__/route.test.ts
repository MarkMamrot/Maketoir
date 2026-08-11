import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), complete: vi.fn(), get: vi.fn(), xero: vi.fn(), report: vi.fn() }));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsSupplierCNRepo: { complete: mocks.complete, get: mocks.get },
  SupplierReturnConflict: class SupplierReturnConflict extends Error {
    readonly code = 'supplier_return_conflict';
  },
}));
vi.mock('@/lib/ims/xeroHooks', () => ({ triggerSupplierCNXeroSync: mocks.xero }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';
import { SupplierReturnConflict } from '@/lib/ims/ImsRepository';

const params = { params: { id: '52' } };

describe('POST /api/ims/supplier-credit-notes/[id]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mocks.complete.mockResolvedValue(undefined);
    mocks.get.mockResolvedValue({ id: 52, status: 'complete' });
    mocks.xero.mockResolvedValue(undefined);
    mocks.report.mockResolvedValue(undefined);
  });

  it('returns 409 when stock or cumulative source allowance changed', async () => {
    mocks.complete.mockRejectedValue(new SupplierReturnConflict('Only 2 units remain returnable.'));

    const response = await POST(new Request('http://localhost', { method: 'POST' }), params);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Only 2 units remain returnable.',
      code: 'supplier_return_conflict',
    });
    expect(mocks.xero).not.toHaveBeenCalled();
  });

  it('keeps Advisor accounts read-only', async () => {
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });

    const response = await POST(new Request('http://localhost', { method: 'POST' }), params);

    expect(response.status).toBe(403);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('keeps local success visible and reports a rejected Xero sync job', async () => {
    mocks.xero.mockRejectedValue(new Error('Xero unavailable'));

    const response = await POST(new Request('http://localhost', { method: 'POST' }), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      xeroSync: { state: 'queued', retryEligible: true, pollEndpoint: '/api/ims/supplier-credit-notes/52/xero-status' },
    });
    await vi.waitFor(() => expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', operation: 'complete_xero_sync',
      reference: { type: 'supplier_credit_note', id: 52 },
    })));
  });
});