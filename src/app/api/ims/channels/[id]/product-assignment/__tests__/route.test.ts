import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), getInstance: vi.fn(), setMode: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  getForBusiness: mocks.getInstance,
  setProductAssignmentModeForBusiness: mocks.setMode,
} }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, PATCH } from '../route';

const context = { params: { id: 'instance-1' } };
function request(method: string, body?: unknown) {
  return new Request('http://localhost/api/ims/channels/instance-1/product-assignment', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('channel product assignment settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.getInstance.mockResolvedValue({ channelInstanceId: 'instance-1', settings: {} });
    mocks.setMode.mockResolvedValue({ channelInstanceId: 'instance-1', settings: { productAssignmentMode: 'add_matches' } });
    mocks.report.mockResolvedValue(undefined);
  });

  it('defaults an unset channel to manual assignment', async () => {
    const response = await GET(request('GET'), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: 'manual' });
  });

  it('updates the exact business-owned channel mode', async () => {
    const response = await PATCH(request('PATCH', { mode: 'add_matches' }), context);
    expect(response.status).toBe(200);
    expect(mocks.setMode).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', mode: 'add_matches',
    });
  });

  it('rejects unsupported modes and non-admin users', async () => {
    expect((await PATCH(request('PATCH', { mode: 'sometimes' }), context)).status).toBe(400);
    expect((await PATCH(request('PATCH', { mode: 'full_sync' }), context)).status).toBe(400);
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Staff' });
    expect((await PATCH(request('PATCH', { mode: 'manual' }), context)).status).toBe(403);
    expect(mocks.setMode).not.toHaveBeenCalled();
  });
});