import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DELIVERY_TRACKING_CHANNELS } from '../deliveryTrackingSettings';

const mocks = vi.hoisted(() => ({ session: vi.fn(), get: vi.fn(), save: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('../deliveryTrackingSettingsRepository', () => ({ getDeliveryTrackingChannels: mocks.get, saveDeliveryTrackingChannels: mocks.save }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { GET, PUT } from '@/app/api/ims/shipping/delivery-settings/route';
const request = (body: unknown = { expectedBusinessId: 'tenant-a', channels: DEFAULT_DELIVERY_TRACKING_CHANNELS }) =>
  new Request('http://localhost/api/ims/shipping/delivery-settings', { method: 'PUT', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ businessId: 'tenant-a', tier: 'Admin' });
  mocks.get.mockResolvedValue({ ...DEFAULT_DELIVERY_TRACKING_CHANNELS });
  mocks.save.mockResolvedValue(undefined); mocks.report.mockResolvedValue(null);
});

describe('delivery tracking preferences API', () => {
  it('reads only the authenticated business with no caching', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: true, businessId: 'tenant-a', channels: DEFAULT_DELIVERY_TRACKING_CHANNELS, readOnly: false });
    expect(mocks.get).toHaveBeenCalledWith('tenant-a');
  });
  it('saves selected types without starting polling or adopting Amazon retention for other types', async () => {
    const channels = { amazon: false, shopify: true, native_shop: false };
    expect((await PUT(request({ expectedBusinessId: 'tenant-a', channels }))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith('tenant-a', channels);
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('blocks anonymous requests and empty business scope', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET()).status).toBe(401); expect((await PUT(request())).status).toBe(401);
    mocks.session.mockResolvedValue({ businessId: '' });
    expect((await GET()).status).toBe(401);
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('lets advisors view but not save settings', async () => {
    mocks.session.mockResolvedValue({ businessId: 'tenant-a', tier: 'Advisor' });
    expect(await (await GET()).json()).toMatchObject({ readOnly: true });
    expect((await PUT(request())).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('rejects a business switch during editing instead of writing to the new tenant', async () => {
    expect((await PUT(request({ expectedBusinessId: 'tenant-b', channels: DEFAULT_DELIVERY_TRACKING_CHANNELS }))).status).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalled();
  });
  it.each([
    { expectedBusinessId: 'tenant-a', channels: { amazon: true } },
    { expectedBusinessId: 'tenant-a', channels: DEFAULT_DELIVERY_TRACKING_CHANNELS, businessId: 'tenant-b' },
    { expectedBusinessId: 'tenant-a', channels: { ...DEFAULT_DELIVERY_TRACKING_CHANNELS, retail: true } },
  ])('rejects malformed settings and scope overrides without operational reports', async body => {
    expect((await PUT(request(body))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalled();
  });
  it('handles malformed JSON as validation, not an operational incident', async () => {
    expect((await PUT(new Request('http://localhost/api', { method: 'PUT', body: '{' }))).status).toBe(400);
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('reports load failures with business scope and no success-shaped defaults', async () => {
    mocks.get.mockRejectedValueOnce(new Error('saved settings invalid'));
    const response = await GET();
    expect(response.status).toBe(500); expect(await response.json()).not.toHaveProperty('channels');
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'tenant-a', operation: 'load_delivery_tracking_settings' }));
  });
  it.each([new Error('database unavailable'), new SyntaxError('driver failure')])('reports operational save failures', async error => {
    mocks.save.mockRejectedValueOnce(error);
    expect((await PUT(request())).status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'tenant-a', operation: 'save_delivery_tracking_settings' }));
  });
});
