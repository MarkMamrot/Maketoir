import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSession,
  mockSOGet,
  mockSOChangeStatus,
  mockPOGet,
  mockPOChangeStatus,
  mockRefresh,
} = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockSOGet: vi.fn(),
  mockSOChangeStatus: vi.fn(),
  mockPOGet: vi.fn(),
  mockPOChangeStatus: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsSORepo: { get: mockSOGet, changeStatus: mockSOChangeStatus },
  ImsPORepo: { get: mockPOGet, changeStatus: mockPOChangeStatus },
}));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: mockRefresh }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));

import { POST } from '../route';

const request = (action: string) => new Request('http://localhost/api/ims/backorders/customer/1', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action }),
});

describe('POST /api/ims/backorders/[type]/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mockRefresh.mockResolvedValue(undefined);
  });

  it('releases a customer backorder without using the supplier repository', async () => {
    mockSOGet.mockResolvedValue({ id: 11, status: 'backordered', items: [{ variant_id: 'v-1' }] });

    const response = await POST(request('release'), { params: { type: 'customer', id: '11' } });

    expect(response.status).toBe(200);
    expect(mockSOChangeStatus).toHaveBeenCalledWith(11, 'confirmed');
    expect(mockPOChangeStatus).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledWith(['v-1']);
  });

  it('cancels a supplier backorder', async () => {
    mockPOGet.mockResolvedValue({ id: 22, status: 'backordered', items: [{ variant_id: 'v-2' }] });

    const response = await POST(request('cancel'), { params: { type: 'supplier', id: '22' } });

    expect(response.status).toBe(200);
    expect(mockPOChangeStatus).toHaveBeenCalledWith(22, 'cancelled');
    expect(mockSOChangeStatus).not.toHaveBeenCalled();
  });

  it('returns a conflict when customer stock is no longer ready at release time', async () => {
    mockSOGet.mockResolvedValue({ id: 11, status: 'backordered', items: [{ variant_id: 'v-1' }] });
    mockSOChangeStatus.mockRejectedValue(new Error('Customer backorder stock is not ready for release.'));

    const response = await POST(request('release'), { params: { type: 'customer', id: '11' } });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('not ready');
  });

  it('rejects stale and Advisor actions', async () => {
    mockSOGet.mockResolvedValue({ id: 11, status: 'confirmed', items: [] });
    expect((await POST(request('release'), { params: { type: 'customer', id: '11' } })).status).toBe(409);

    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    expect((await POST(request('release'), { params: { type: 'customer', id: '11' } })).status).toBe(403);
  });
});