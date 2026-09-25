import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), disabled: vi.fn(), enter: vi.fn(), push: vi.fn(), drain: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/shopifyCapability', () => ({ shopifyDisabledResponse: mocks.disabled }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ enterImsForBusiness: mocks.enter, runImsForBusiness: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: vi.fn(), imsExecute: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query: vi.fn() }));
vi.mock('@/lib/ims/shopifyInventorySync', () => ({
  drainInventoryQueue: mocks.drain,
  pushInventoryForShopifyInstance: mocks.push,
}));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: vi.fn() }));
vi.mock('@/lib/channels/shopifyInstanceSettings', () => ({ shopifyInstanceSettings: vi.fn() }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {} }));

import { POST } from '../route';

describe('exact-instance Shopify inventory route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.disabled.mockResolvedValue(null);
    mocks.enter.mockResolvedValue(undefined);
    mocks.push.mockResolvedValue({ pushed: 2, skipped: 0, errors: [], locationId: 44 });
  });

  it('rejects a direct inventory push without an exact instance', async () => {
    const response = await POST(new Request('http://localhost/api/ims/shopify/sync-inventory', {
      method: 'POST', body: JSON.stringify({ mode: 'all' }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('routes a direct inventory push to the selected instance', async () => {
    const response = await POST(new Request('http://localhost/api/ims/shopify/sync-inventory', {
      method: 'POST', body: JSON.stringify({ mode: 'all', channelInstanceId: 'store-b' }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.push).toHaveBeenCalledWith({
      businessId: 'biz-1', channelInstanceId: 'store-b', all: true, force: true,
    });
  });
});