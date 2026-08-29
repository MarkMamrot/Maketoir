import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  setActive: vi.fn(),
  getCapabilities: vi.fn(),
  getStripe: vi.fn(),
  query: vi.fn(),
  imsQuery: vi.fn(),
}));

vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: vi.fn((_businessId, work) => work()) }));
vi.mock('@/lib/onlineShop/onlineShopProfile', () => ({
  OnlineShopProfileRepository: { getByBusinessId: mocks.getProfile, setActive: mocks.setActive },
  OnlineSalesChannelRepository: { getCapabilities: mocks.getCapabilities },
}));
vi.mock('@/lib/onlineShop/stripeConnect', () => ({
  OnlineShopStripeConnectionRepository: { get: mocks.getStripe },
}));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));

import { getOnlineShopActivationState, setOnlineShopActivation } from '../onlineShopActivation';

describe('online shop activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_test';
    mocks.getProfile.mockResolvedValue({ isActive: true });
    mocks.getCapabilities.mockResolvedValue({ shopifyEnabled: true, nativeShopEnabled: true });
    mocks.getStripe.mockResolvedValue({ chargesEnabled: true, detailsSubmitted: true });
    mocks.query.mockResolvedValue([{ published_revision: 1 }]);
    mocks.imsQuery.mockResolvedValue([{ count: 1 }]);
  });

  it('reports native active while Shopify is also enabled', async () => {
    await expect(getOnlineShopActivationState('business-1')).resolves.toMatchObject({
      activeChannel: 'native_shop',
      isActive: true,
      ready: true,
    });
  });

  it('activates the native profile without changing channel capabilities', async () => {
    await setOnlineShopActivation({ businessId: 'business-1', active: true });
    expect(mocks.setActive).toHaveBeenCalledWith('business-1', true);
    expect(mocks.getCapabilities).toHaveBeenCalled();
  });
});