import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), context: vi.fn(), report: vi.fn() }));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsPORepo: { getSupplierReturnContext: mocks.context } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET } from '../route';

const params = { params: { id: '42' } };

describe('GET /api/ims/purchase-orders/[id]/supplier-return-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mocks.report.mockResolvedValue(null);
  });

  it('returns tenant-scoped completed PO return context', async () => {
    mocks.context.mockResolvedValue({ po_id: 42, items: [{ source_po_item_id: 11, remaining_returnable_qty: 4 }] });

    const response = await GET(new Request('http://localhost'), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { po_id: 42, items: [{ source_po_item_id: 11, remaining_returnable_qty: 4 }] },
    });
    expect(mocks.context).toHaveBeenCalledWith(42, 'biz-1');
  });

  it('returns 404 without reporting an expected unavailable source', async () => {
    mocks.context.mockResolvedValue(null);

    const response = await GET(new Request('http://localhost'), params);

    expect(response.status).toBe(404);
    expect(mocks.report).not.toHaveBeenCalled();
  });
});