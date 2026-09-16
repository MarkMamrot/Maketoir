import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), getInstance: vi.fn(), listRules: vi.fn(), replaceRules: vi.fn(),
  evaluate: vi.fn(), setOverride: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  getForBusiness: mocks.getInstance,
} }));
vi.mock('@/lib/channels/channelProductAssignmentRepository', () => ({
  listChannelProductRules: mocks.listRules,
  replaceChannelProductRules: mocks.replaceRules,
  evaluateChannelProducts: mocks.evaluate,
  setChannelProductOverride: mocks.setOverride,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, PATCH, POST, PUT } from '../route';

const context = { params: { id: 'instance-1' } };
function request(method: string, body?: unknown, query = '') {
  return new Request(`http://localhost/api/ims/channels/instance-1/product-rules${query}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('channel product rules route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', userId: 7, name: 'Admin', tier: 'Admin' });
    mocks.getInstance.mockResolvedValue({ channelInstanceId: 'instance-1', provider: 'shopify' });
    mocks.listRules.mockResolvedValue([]);
    mocks.replaceRules.mockResolvedValue([]);
    mocks.evaluate.mockResolvedValue({ products: [], total: 0, applied: 0 });
    mocks.report.mockResolvedValue(undefined);
  });

  it('rejects a channel outside the signed-in business', async () => {
    mocks.getInstance.mockResolvedValue(null);
    expect((await GET(request('GET'), context)).status).toBe(404);
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });

  it('loads rules and a bounded preview for the exact channel', async () => {
    const response = await GET(request('GET', undefined, '?search=dress&limit=50&offset=100'), context);
    expect(response.status).toBe(200);
    expect(mocks.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'instance-1', search: 'dress', limit: 50, offset: 100,
    }));
  });

  it('saves ordered rules without applying provider intent', async () => {
    const rules = [{ name: 'Online', conditions: [{ field: 'online_candidate', operator: 'equals', value: true }] }];
    const response = await PUT(request('PUT', { rules }), context);
    expect(response.status).toBe(200);
    expect(mocks.replaceRules).toHaveBeenCalledWith(expect.objectContaining({ rules, actorUserId: 7, actorName: 'Admin' }));
    expect(mocks.evaluate).toHaveBeenCalledWith(expect.not.objectContaining({ apply: true }));
  });

  it('applies evaluated intent only when explicitly requested', async () => {
    await POST(request('POST', { apply: true, limit: 500 }), context);
    expect(mocks.evaluate).toHaveBeenCalledWith(expect.objectContaining({ apply: true, limit: 500 }));
  });

  it('validates and saves a persistent override', async () => {
    expect((await PATCH(request('PATCH', { productId: 'product-1', overrideMode: 'include' }), context)).status).toBe(200);
    expect(mocks.setOverride).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'instance-1', productId: 'product-1', overrideMode: 'include',
    }));
    expect((await PATCH(request('PATCH', { productId: 'product-1', overrideMode: 'sometimes' }), context)).status).toBe(400);
  });
});
