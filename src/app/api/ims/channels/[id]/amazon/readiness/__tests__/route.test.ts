import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), assess: vi.fn(), report: vi.fn() }));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/amazonReadiness', () => ({ assessAmazonReadiness: mocks.assess }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

const request = new Request('http://localhost/api/ims/channels/instance-1/amazon/readiness', { method: 'POST' });
const context = { params: { id: 'instance-1' } };

describe('POST Amazon channel readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.assess.mockResolvedValue({ ready: false, checks: [{ key: 'listings', passed: false }] });
    mocks.report.mockResolvedValue(undefined);
  });

  it('requires an administrator', async () => {
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'StandardUser' });
    expect((await POST(request, context)).status).toBe(403);
    expect(mocks.assess).not.toHaveBeenCalled();
  });

  it('checks the exact business and channel instance without activating it', async () => {
    const response = await POST(request, context);

    expect(response.status).toBe(200);
    expect(mocks.assess).toHaveBeenCalledWith({ businessId: 'business-1', channelInstanceId: 'instance-1' });
    expect(await response.json()).toEqual({
      success: true, ready: false, checks: [{ key: 'listings', passed: false }],
    });
  });

  it('reports an operational failure without returning provider details', async () => {
    mocks.assess.mockRejectedValue(new Error('provider payload with token'));
    const response = await POST(request, context);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Amazon activation readiness could not be checked.' });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'check_activation_readiness',
      context: { channelInstanceId: 'instance-1' },
    }));
  });
});