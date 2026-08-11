import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), complete: vi.fn(), get: vi.fn(), xero: vi.fn(), report: vi.fn() }));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsCNRepo: { complete: mocks.complete, get: mocks.get } }));
vi.mock('@/lib/ims/xeroHooks', () => ({ triggerCNXeroSync: mocks.xero }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

const params = { params: { id: '41' } };

describe('POST /api/ims/credit-notes/[id]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mocks.complete.mockResolvedValue(undefined);
    mocks.get.mockResolvedValue({ id: 41, status: 'complete' });
    mocks.xero.mockResolvedValue(undefined);
    mocks.report.mockResolvedValue(undefined);
  });

  it('keeps local completion successful and reports a rejected Xero sync job', async () => {
    mocks.xero.mockRejectedValue(new Error('Xero unavailable'));

    const response = await POST(new Request('http://localhost', { method: 'POST' }), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      xeroSync: { state: 'queued', retryEligible: true, pollEndpoint: '/api/ims/credit-notes/41/xero-status' },
    });
    await vi.waitFor(() => expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', operation: 'complete_xero_sync',
      reference: { type: 'credit_note', id: 41 },
    })));
  });

  it('keeps Advisor accounts read-only', async () => {
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });

    const response = await POST(new Request('http://localhost', { method: 'POST' }), params);

    expect(response.status).toBe(403);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });
});