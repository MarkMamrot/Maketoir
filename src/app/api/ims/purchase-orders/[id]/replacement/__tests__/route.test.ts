import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), replacement: vi.fn(), report: vi.fn() }));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsPORepo: { createReplacement: mocks.replacement } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';
import { OrderAmendmentConflict } from '@/lib/ims/orderAmendmentPlan';

const request = new Request('http://localhost/api/ims/purchase-orders/42/replacement', { method: 'POST' });

describe('POST /api/ims/purchase-orders/[id]/replacement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mocks.report.mockResolvedValue(undefined);
  });

  it('returns the stable replacement id and replay state', async () => {
    mocks.replacement.mockResolvedValue({ id: 88, replayed: true });
    const response = await POST(request, { params: { id: '42' } });
    expect(await response.json()).toEqual({ success: true, id: 88, replayed: true });
    expect(mocks.replacement).toHaveBeenCalledWith(42, 'biz-1');
  });

  it('returns 409 without reporting expected lifecycle conflicts', async () => {
    mocks.replacement.mockRejectedValue(new OrderAmendmentConflict('Completed or Cancelled only.'));
    const response = await POST(request, { params: { id: '42' } });
    expect(response.status).toBe(409);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('keeps Advisor accounts read-only', async () => {
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    const response = await POST(request, { params: { id: '42' } });
    expect(response.status).toBe(403);
    expect(mocks.replacement).not.toHaveBeenCalled();
  });
});