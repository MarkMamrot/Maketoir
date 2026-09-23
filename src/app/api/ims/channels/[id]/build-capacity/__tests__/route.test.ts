import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  getInstance: vi.fn(),
  setPolicy: vi.fn(),
  imsQuery: vi.fn(),
  report: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/channelInstanceRepository', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/channels/channelInstanceRepository')>();
  return { ...actual, SalesChannelInstanceRepository: {
    getForBusiness: mocks.getInstance,
    setBuildCapacityPolicyForBusiness: mocks.setPolicy,
  } };
});
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, PATCH } from '../route';

const context = { params: { id: 'instance-1' } };
function request(method: string, body?: unknown) {
  return new Request('http://localhost/api/ims/channels/instance-1/build-capacity', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function instance(settings: Record<string, unknown> = {}) {
  return { channelInstanceId: 'instance-1', provider: 'shopify', settings };
}

describe('channel Build Capacity settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.getInstance.mockResolvedValue(instance());
    mocks.imsQuery.mockResolvedValue([{ id: 2, name: 'Workroom' }, { id: 7, name: 'Warehouse' }]);
  });

  it('returns an off-by-default exact-channel policy and active locations', async () => {
    const response = await GET(request('GET'), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      enabled: false,
      inventoryLocationIds: [],
      locations: [{ id: 2, name: 'Workroom' }, { id: 7, name: 'Warehouse' }],
    });
  });

  it('persists validated locations for the exact channel instance', async () => {
    mocks.setPolicy.mockResolvedValue(instance({ buildCapacityEnabled: 1, inventoryLocationIds: [7, 2] }));
    const response = await PATCH(request('PATCH', { enabled: true, inventoryLocationIds: [7, 2, 7] }), context);
    expect(response.status).toBe(200);
    expect(mocks.setPolicy).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', enabled: true, inventoryLocationIds: [7, 2],
    });
  });

  it('rejects locations outside the tenant active-location list', async () => {
    const response = await PATCH(request('PATCH', { enabled: true, inventoryLocationIds: [99] }), context);
    expect(response.status).toBe(400);
    expect(mocks.setPolicy).not.toHaveBeenCalled();
  });

  it('requires administrator access', async () => {
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'StandardUser' });
    expect((await GET(request('GET'), context)).status).toBe(403);
  });
});