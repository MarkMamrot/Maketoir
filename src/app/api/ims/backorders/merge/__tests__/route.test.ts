import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockCustomerMerge, mockSupplierMerge, mockRefresh } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockCustomerMerge: vi.fn(),
  mockSupplierMerge: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/backorders/mergeBackorders', () => ({
  mergeCustomerBackorders: mockCustomerMerge,
  mergeSupplierBackorders: mockSupplierMerge,
}));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: mockRefresh }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));

import { POST } from '../route';

const request = (body: any) => new Request('http://localhost/api/ims/backorders/merge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('POST /api/ims/backorders/merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mockRefresh.mockResolvedValue(undefined);
  });

  it('routes customer merges with explicit tenant context', async () => {
    mockCustomerMerge.mockResolvedValue({ targetOrderId: 11, variantIds: ['v-1'] });
    const response = await POST(request({ type: 'customer', orderIds: [11, 12], operationKey: 'merge-1' }));

    expect(response.status).toBe(200);
    expect(mockCustomerMerge).toHaveBeenCalledWith({
      businessId: 'biz-1', orderIds: [11, 12], operationKey: 'merge-1',
    });
    expect(mockSupplierMerge).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledWith(['v-1']);
  });

  it('routes supplier merges independently', async () => {
    mockSupplierMerge.mockResolvedValue({ targetOrderId: 21, variantIds: [] });
    const response = await POST(request({ type: 'supplier', orderIds: [21, 22], operationKey: 'merge-2' }));

    expect(response.status).toBe(200);
    expect(mockSupplierMerge).toHaveBeenCalledOnce();
    expect(mockCustomerMerge).not.toHaveBeenCalled();
  });

  it('keeps Advisor access read-only', async () => {
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    expect((await POST(request({ type: 'customer', orderIds: [1, 2], operationKey: 'x' }))).status).toBe(403);
    expect(mockCustomerMerge).not.toHaveBeenCalled();
  });
});