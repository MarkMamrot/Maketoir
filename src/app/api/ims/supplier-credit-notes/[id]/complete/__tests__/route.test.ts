import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), complete: vi.fn(), get: vi.fn(), xero: vi.fn() }));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsSupplierCNRepo: { complete: mocks.complete, get: mocks.get },
  SupplierReturnConflict: class SupplierReturnConflict extends Error {
    readonly code = 'supplier_return_conflict';
  },
}));
vi.mock('@/lib/ims/xeroHooks', () => ({ triggerSupplierCNXeroSync: mocks.xero }));

import { POST } from '../route';
import { SupplierReturnConflict } from '@/lib/ims/ImsRepository';

const params = { params: { id: '52' } };

describe('POST /api/ims/supplier-credit-notes/[id]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
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
});