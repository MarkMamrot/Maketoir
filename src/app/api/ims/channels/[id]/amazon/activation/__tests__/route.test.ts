import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), setActivation: vi.fn(), report: vi.fn() }));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/amazonActivation', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/channels/amazonActivation')>()), setAmazonActivation: mocks.setActivation,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { AmazonActivationBlockedError } from '@/lib/channels/amazonActivation';
import { POST } from '../route';

const context = { params: { id: 'instance-1' } };
const request = (body: unknown) => new Request('http://localhost/api/ims/channels/instance-1/amazon/activation', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('POST Amazon channel activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', userId: 7, tier: 'Admin' });
    mocks.setActivation.mockResolvedValue({ instance: { enabled: true }, checks: [] });
    mocks.report.mockResolvedValue(undefined);
  });

  it('requires an administrator and a boolean state', async () => {
    mocks.session.mockResolvedValueOnce({ businessId: 'business-1', tier: 'StandardUser' });
    expect((await POST(request({ active: true }), context)).status).toBe(403);
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    expect((await POST(request({ active: 'yes' }), context)).status).toBe(400);
    expect(mocks.setActivation).not.toHaveBeenCalled();
  });

  it('passes the exact tenant, instance, actor, and requested state', async () => {
    const response = await POST(request({ active: true }), context);

    expect(response.status).toBe(200);
    expect(mocks.setActivation).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', active: true, actorUserId: 7,
    });
  });

  it('returns readiness blockers as an expected conflict', async () => {
    const checks = [{ key: 'orders', label: 'Order synchronization', passed: false, detail: 'Run Sync orders successfully.' }];
    mocks.setActivation.mockRejectedValue(new AmazonActivationBlockedError(checks));

    const response = await POST(request({ active: true }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false, error: 'Complete every Amazon activation-readiness check before activation.', checks,
    });
    expect(mocks.report).not.toHaveBeenCalled();
  });
});