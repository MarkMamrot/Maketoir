import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), run: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
import { ADVISOR_XERO_SYNC_SETTING, getXeroSyncAccessDenied } from '../advisorSyncAccess';

describe('Advisor Xero sync permission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockImplementation((_businessId, callback) => callback());
    mocks.query.mockResolvedValue([]);
  });
  it('defaults to denied for Advisors', async () => {
    expect((await getXeroSyncAccessDenied({ businessId: 'biz-1', tier: 'Advisor' }))?.status).toBe(403);
  });
  it.each(['false', '0', 'yes', ''])('denies disabled or unsupported values: %s', async value => {
    mocks.query.mockResolvedValue([{ value }]);
    expect((await getXeroSyncAccessDenied({ businessId: 'biz-1', tier: 'Advisor' }))?.status).toBe(403);
  });
  it.each(['true', '1'])('allows an explicitly enabled Advisor: %s', async value => {
    mocks.query.mockResolvedValue([{ value }]);
    expect(await getXeroSyncAccessDenied({ businessId: 'biz-2', tier: 'Advisor' })).toBeNull();
    expect(mocks.run).toHaveBeenCalledWith('biz-2', expect.any(Function));
    expect(mocks.query).toHaveBeenCalledWith(expect.any(String), ['biz-2', ADVISOR_XERO_SYNC_SETTING]);
  });
  it('preserves existing non-Advisor access without a settings query', async () => {
    expect(await getXeroSyncAccessDenied({ businessId: 'biz-1', tier: 'Admin' })).toBeNull();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('fails closed if settings cannot be read', async () => {
    mocks.query.mockRejectedValue(new Error('Database unavailable'));
    await expect(getXeroSyncAccessDenied({ businessId: 'biz-1', tier: 'Advisor' })).rejects.toThrow('Database unavailable');
  });
});