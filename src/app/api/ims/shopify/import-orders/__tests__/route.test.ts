import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  session: vi.fn(), context: vi.fn(), control: vi.fn(), request: vi.fn(), orders: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mocks.context }));
vi.mock('@/lib/channels/onlineSyncControl', () => ({ getOnlineSyncControl: mocks.control }));
vi.mock('@/lib/channels/onlineRecoveryWorker', () => ({ requestOnlineRecovery: mocks.request }));
vi.mock('@/lib/db/BusinessRegistry', () => ({
  runImsForBusiness: async (_business: string, callback: () => Promise<unknown>) => callback(),
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/shopifyCapability', () => ({ shopifyDisabledResponse: async () => null }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({
  SalesChannelInstanceRepository: { setShopifySettingsForBusiness: vi.fn() },
}));
vi.mock('@/lib/channels/shopifyOrderImport', () => ({ importShopifyOrder: vi.fn() }));
vi.mock('@/lib/channels/shopifyOrderUpdate', () => ({ updateShopifyOrder: vi.fn() }));
vi.mock('@/lib/channels/shopifyOrderRefund', () => ({ applyShopifyOrderRefund: vi.fn() }));
vi.mock('@/services/ShopifyService', () => ({ ShopifyService: class { getAllOrders = mocks.orders; } }));
import { POST } from '../route';
function request() {
  return new Request('http://localhost/api/ims/shopify/import-orders', {
    method: 'POST', body: JSON.stringify({ channelInstanceId: 'store' }),
  });
}
describe('manual Shopify import activation compatibility', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'alpha', tier: 'Admin' });
    mocks.context.mockResolvedValue({
      instance: { settings: { shopify: { orders: { enabled: true, syncFrom: '2026-01-01', locationId: 7 } } } },
      credentials: { shopDomain: 'test.myshopify.com', token: 'fixture' },
    });
    mocks.control.mockResolvedValue({ mode: 'cutover', paused: false });
    mocks.orders.mockResolvedValue([]);
  });
  it('queues exact-store bounded work without scanning historical orders', async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ success: true, queued: true, channelInstanceId: 'store' });
    expect(mocks.request).toHaveBeenCalledWith('alpha', 'store');
    expect(mocks.orders).not.toHaveBeenCalled();
  });
  it('never restores a historical scan while activated recovery is paused', async () => {
    mocks.control.mockResolvedValue({ mode: 'validation', paused: true });
    expect((await POST(request())).status).toBe(409);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.orders).not.toHaveBeenCalled();
  });
  it('preserves legacy counts for inactive storefronts', async () => {
    mocks.control.mockResolvedValue({ mode: 'legacy', paused: false });
    expect(await (await POST(request())).json()).toMatchObject({ success: true, imported: 0, updated: 0 });
    expect(mocks.orders).toHaveBeenCalledWith('2026-01-01');
  });
  it('does not fall back to scanning when durable handoff fails', async () => {
    mocks.request.mockRejectedValue(new Error('private'));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.orders).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.report.mock.calls)).not.toContain('private');
  });
  it('keeps the admin import authentication boundary', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.control).not.toHaveBeenCalled();
  });
});
