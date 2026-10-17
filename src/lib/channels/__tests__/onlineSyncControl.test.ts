import { beforeEach, describe, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
const mainQuery = vi.hoisted(() => vi.fn());
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: query }));
vi.mock('@/services/MySQLService', () => ({ query: mainQuery }));
import { assertOnlineRecoveryBusinessActive, getOnlineSyncControl } from '../onlineSyncControl';

describe('online recovery rollout gates', () => {
  beforeEach(() => vi.resetAllMocks());
  it('retains legacy behavior before migration', async () => {
    query.mockResolvedValueOnce([]);
    expect(await getOnlineSyncControl('alpha')).toEqual({ mode: 'legacy', paused: false, installed: false });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('does not auto-activate a migrated tenant', async () => {
    query.mockResolvedValueOnce([{ present: 1 }]).mockResolvedValueOnce([]);
    expect((await getOnlineSyncControl('alpha')).mode).toBe('legacy');
  });
  it('keeps cutover independent from pause', async () => {
    query.mockResolvedValueOnce([{ present: 1 }]).mockResolvedValueOnce([{ rollout_state: 'cutover', paused: 1 }]);
    expect(await getOnlineSyncControl('alpha')).toEqual({ mode: 'cutover', paused: true, installed: true });
    expect(query.mock.calls[1][1]).toEqual(['alpha']);
  });
  it('propagates database failures rather than falling back to historical work', async () => {
    query.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(getOnlineSyncControl('alpha')).rejects.toThrow('Database unavailable');
  });
  it('rejects malformed rollout state', async () => {
    query.mockResolvedValueOnce([{ present: 1 }]).mockResolvedValueOnce([{ rollout_state: 'unknown', paused: 0 }]);
    await expect(getOnlineSyncControl('alpha')).rejects.toThrow('Invalid persisted');
  });
  it('requires a still-active exact business before background effects', async () => {
    mainQuery.mockResolvedValueOnce([{ business_id: 'alpha' }]).mockResolvedValueOnce([]);
    await expect(assertOnlineRecoveryBusinessActive('alpha')).resolves.toBeUndefined();
    expect(mainQuery.mock.calls[0][1]).toEqual(['alpha']);
    expect(mainQuery.mock.calls[0][0]).toContain('automation_paused');
    await expect(assertOnlineRecoveryBusinessActive('alpha')).rejects.toThrow('no longer owned');
  });
});
