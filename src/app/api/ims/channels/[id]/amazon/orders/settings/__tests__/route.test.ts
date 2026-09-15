import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), getInstance: vi.fn(), setLocation: vi.fn(), query: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({
  SalesChannelValidationError: class SalesChannelValidationError extends Error {},
  SalesChannelInstanceRepository: {
    getForBusiness: mocks.getInstance,
    setAmazonOrderLocationForBusiness: mocks.setLocation,
  },
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, PATCH } from '../route';

const context = { params: { id: 'instance-1' } };
const request = (body: unknown) => new Request('http://localhost/settings', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('Amazon order settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.getInstance.mockResolvedValue({ provider: 'amazon', settings: { orderLocationId: 7 } });
    mocks.query.mockResolvedValue([{ id: 7, name: 'Dispatch' }]);
    mocks.setLocation.mockResolvedValue({ provider: 'amazon' });
    mocks.report.mockResolvedValue(1);
  });

  it('returns active tenant locations and the valid configured location', async () => {
    const response = await GET(new Request('http://localhost/settings'), context);
    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('business_id = ?'), ['business-1']);
    expect(await response.json()).toEqual({
      success: true, orderLocationId: 7, locations: [{ id: 7, name: 'Dispatch' }],
    });
  });

  it('requires an administrator to change the dispatch location', async () => {
    mocks.session.mockResolvedValueOnce({ businessId: 'business-1', tier: 'StandardUser' });
    expect((await PATCH(request({ orderLocationId: 7 }), context)).status).toBe(403);
    expect(mocks.setLocation).not.toHaveBeenCalled();
  });

  it('validates the location in the current tenant before saving it', async () => {
    mocks.query.mockResolvedValueOnce([]);
    expect((await PATCH(request({ orderLocationId: 99 }), context)).status).toBe(400);
    expect(mocks.setLocation).not.toHaveBeenCalled();
  });

  it('saves the location on the exact Amazon instance', async () => {
    const response = await PATCH(request({ orderLocationId: 7 }), context);
    expect(response.status).toBe(200);
    expect(mocks.setLocation).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', locationId: 7,
    });
  });
});