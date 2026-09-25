import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), activation: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  setShopifyActivationForBusiness: mocks.activation,
} }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

const context = { params: { id: 'instance-1' } };
function request(active: boolean) {
  return new Request('http://localhost/api/ims/channels/instance-1/shopify/activation', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }) });
}

describe('Shopify channel activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.activation.mockResolvedValue({ channelInstanceId: 'instance-1', enabled: true });
  });

  it('activates the exact business-owned ready instance', async () => {
    expect((await POST(request(true), context)).status).toBe(200);
    expect(mocks.activation).toHaveBeenCalledWith({ businessId: 'business-1', channelInstanceId: 'instance-1', active: true });
  });

  it('returns a readiness conflict when activation no longer qualifies', async () => {
    mocks.activation.mockResolvedValue(null);
    const response = await POST(request(true), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('Test this Shopify connection') });
  });
});