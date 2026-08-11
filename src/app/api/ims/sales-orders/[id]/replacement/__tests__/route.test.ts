import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), replacement: vi.fn(), report: vi.fn() }));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsSORepo: { createReplacement: mocks.replacement } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

const request = new Request('http://localhost/api/ims/sales-orders/52/replacement', { method: 'POST' });

describe('POST /api/ims/sales-orders/[id]/replacement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mocks.report.mockResolvedValue(undefined);
  });

  it('creates a tenant-scoped replacement Draft', async () => {
    mocks.replacement.mockResolvedValue({ id: 98, replayed: false });
    const response = await POST(request, { params: { id: '52' } });
    expect(await response.json()).toEqual({ success: true, id: 98, replayed: false });
    expect(mocks.replacement).toHaveBeenCalledWith(52, 'biz-1');
  });

  it('reports unexpected operational failures', async () => {
    mocks.replacement.mockRejectedValue(new Error('database unavailable'));
    const response = await POST(request, { params: { id: '52' } });
    expect(response.status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', operation: 'create_replacement', reference: { type: 'sales_order', id: 52 },
    }));
  });
});