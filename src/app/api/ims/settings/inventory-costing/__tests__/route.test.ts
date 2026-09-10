import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
  report: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/costing/inventoryCostSwitch', () => ({
  FIFO_COSTING_ACTIVATION_READY: true,
  previewInventoryCostMethodSwitch: mocks.preview,
  switchInventoryCostMethod: mocks.apply,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, POST } from '../route';

describe('inventory costing settings API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin', userId: 7, name: 'Alex' });
    mocks.preview.mockResolvedValue({ currentMethod: 'average_cost', targetMethod: 'fifo', revision: 1, blockers: [] });
    mocks.apply.mockResolvedValue({ epochId: 44, replayed: false, preview: { revision: 2 } });
  });

  it('returns a tenant-scoped switch preview', async () => {
    const response = await GET(new Request('http://localhost/api/ims/settings/inventory-costing?targetMethod=fifo'));
    expect(response.status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith('biz-1', 'fifo');
  });

  it('requires administrator access', async () => {
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    const response = await POST(new Request('http://localhost/api/ims/settings/inventory-costing', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(403);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('passes revision, idempotency, reason, and actor to the switch transaction', async () => {
    const response = await POST(new Request('http://localhost/api/ims/settings/inventory-costing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetMethod: 'fifo', expectedRevision: 1, operationKey: 'switch-1', reason: 'Future FIFO costing' }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.apply).toHaveBeenCalledWith({
      businessId: 'biz-1',
      targetMethod: 'fifo',
      expectedRevision: 1,
      operationKey: 'switch-1',
      reason: 'Future FIFO costing',
      actorId: 7,
      actorName: 'Alex',
    });
  });
});