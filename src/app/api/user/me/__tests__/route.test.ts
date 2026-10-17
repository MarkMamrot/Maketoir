import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), find: vi.fn(), query: vi.fn(), control: vi.fn(), report: vi.fn(), tenant: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ getAdminSession: mocks.session }));
vi.mock('@/lib/auth/businessAccess', () => ({
  resolveActorBusinessAccess: mocks.access, findAccessibleBusiness: mocks.find,
}));
vi.mock('@/lib/businessFeatures', () => ({
  emptyBusinessFeatureFlags: () => ({}), getBusinessFeatureFlags: async () => ({}),
}));
vi.mock('@/lib/ims/businessOperations', () => ({
  getOnlineChannelCapabilities: async () => ({ shopifyEnabled: true, nativeShopEnabled: false }),
}));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.tenant }));
vi.mock('@/lib/channels/onlineSyncControl', () => ({ getOnlineSyncControl: mocks.control }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { GET } from '../route';
describe('IMS startup capabilities in the existing user-context response', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockReturnValue({ userId: 1, businessId: 'alpha' });
    mocks.access.mockResolvedValue({ actor: { name: 'Admin', email: 'admin@example.test', tier: 'Admin' }, businesses: [] });
    mocks.find.mockReturnValue({ businessId: 'alpha', name: 'Alpha', tier: 'Admin', hasIms: true, hasPos: true });
    mocks.query.mockResolvedValue([{ ims_db_name: 'isolated_alpha' }]);
    mocks.control.mockResolvedValue({ mode: 'cutover' });
    mocks.tenant.mockImplementation(async (_business: string, callback: () => Promise<unknown>) => callback());
    mocks.report.mockResolvedValue(undefined);
  });
  it('suppresses startup without disabling online channel functionality at verified cutover', async () => {
    expect(await (await GET()).json()).toMatchObject({
      businessId: 'alpha', onlineSalesStartupEnabled: false, onlineChannels: { shopifyEnabled: true },
    });
    expect(mocks.tenant).toHaveBeenCalledWith('alpha', expect.any(Function));
  });
  it.each(['legacy', 'validation'])('retains legacy-compatible startup eligibility in %s', async mode => {
    mocks.control.mockResolvedValue({ mode });
    expect(await (await GET()).json()).toMatchObject({ onlineSalesStartupEnabled: true });
  });
  it('does not break onboarding when IMS is enabled but the database has not been provisioned', async () => {
    mocks.query.mockResolvedValue([{ ims_db_name: null }]);
    expect((await GET()).status).toBe(200);
    expect(mocks.tenant).not.toHaveBeenCalled();
  });
  it('does not query tenant tables for Foresight-only users', async () => {
    mocks.find.mockReturnValue({ businessId: 'alpha', name: 'Alpha', tier: 'Admin', hasIms: false, hasPos: false });
    expect((await GET()).status).toBe(200);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.tenant).not.toHaveBeenCalled();
  });
  it('retains active-business access validation ahead of tenant reads', async () => {
    mocks.find.mockReturnValue(null);
    expect((await GET()).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('surfaces control failure instead of reporting a legacy startup capability', async () => {
    mocks.control.mockRejectedValue(new Error('control unavailable'));
    expect((await GET()).status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'alpha' }));
  });
});
