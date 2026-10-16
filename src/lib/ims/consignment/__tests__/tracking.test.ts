import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';
const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('../db', () => ({ query: mocks.query, execute: mocks.execute }));
import { getTrackingInterval, transitionTracking } from '../tracking';
const db = {} as PoolConnection;
beforeEach(() => { vi.clearAllMocks(); mocks.execute.mockResolvedValue({ insertId: 4 }); });
describe('cutover source assignment', () => {
  it('locks shared tracking state and captures reliability while off without creating a managed claim', async () => {
    mocks.query.mockResolvedValue([{ enabled: 0, active_interval_id: null }]);
    expect(await getTrackingInterval(db, 'tenant', '2026-10-16')).toBeNull();
    expect(mocks.query.mock.calls[0][1]).toContain('FOR UPDATE');
    expect(mocks.execute.mock.calls.some(call => call[1].includes('evidence_from=LEAST'))).toBe(true);
  });
  it('never assigns pre-cutover facts to the active interval', async () => {
    mocks.query.mockResolvedValueOnce([{ enabled: 1, active_interval_id: 4 }]).mockResolvedValueOnce([{ id: 4, cutover_date: '2026-10-16', disabled_at: null }]);
    expect(await getTrackingInterval(db, 'tenant', '2026-10-15')).toBeNull();
  });
  it('assigns qualifying facts only to the current open interval', async () => {
    mocks.query.mockResolvedValueOnce([{ enabled: 1, active_interval_id: 4 }]).mockResolvedValueOnce([{ id: 4, cutover_date: '2026-10-16', disabled_at: null }]);
    expect(await getTrackingInterval(db, 'tenant', '2026-10-16')).toBe(4);
  });
  it('requires external acknowledgement and rejects stale desired-state transitions', async () => {
    mocks.query.mockResolvedValue([{ enabled: 0, active_interval_id: null }]);
    await expect(transitionTracking(db, 'tenant', 1, { enabled: true, cutoverDate: '2026-10-16' })).rejects.toThrow('Acknowledge');
    await expect(transitionTracking(db, 'tenant', 1, { enabled: false })).rejects.toThrow('already changed');
  });
  it('blocks disabling with outstanding drafts/finalised or uncertain sends', async () => {
    mocks.query.mockImplementation(async (_db, sql: string) => {
      if (sql.includes('tracking_state')) return [{ enabled: 1, active_interval_id: 4 }];
      if (sql.includes('FROM ims_consignment_statements')) return [{ id: 9, status: 'Finalised' }];
      return [];
    });
    await expect(transitionTracking(db, 'tenant', 1, { enabled: false, acknowledgeHandover: true, reason: 'External' })).rejects.toThrow('account or cancel');
    expect(mocks.execute.mock.calls.some(call => call[1].includes('SET enabled=0'))).toBe(false);
  });
  it('enables through an explicit audited cutover without claiming or replaying report-only activity', async () => {
    let enabled = false;
    mocks.execute.mockImplementation(async (_db, sql: string) => {
      if (sql.includes('SET enabled=1')) enabled = true;
      return { insertId: 4, affectedRows: 1 };
    });
    mocks.query.mockImplementation(async (_db, sql: string) => {
      if (sql.includes('FROM ims_consignment_tracking_state')) return [{ enabled: enabled ? 1 : 0, evidence_from: '2020-01-01', active_interval_id: enabled ? 4 : null }];
      if (sql.includes('FROM ims_settings')) return [{ value: 'Australia/Sydney' }];
      if (sql.includes('disabled_at IS NOT NULL')) return [];
      if (sql.includes('FROM ims_consignment_tracking_intervals')) return enabled ? [{ id: 4, cutover_date: '2020-01-02', disabled_at: null }] : [];
      return [];
    });
    const result = await transitionTracking(db, 'tenant', 42, { enabled: true, cutoverDate: '2020-01-02', acknowledgeExternal: true });
    expect(result.enabled).toBe(true);
    expect(result.interval).toMatchObject({ id: 4, cutover_date: '2020-01-02' });
    expect(mocks.execute).toHaveBeenCalledWith(db, expect.stringContaining('INSERT INTO ims_consignment_tracking_intervals'), ['tenant', '2020-01-02', 42]);
    expect(mocks.execute).toHaveBeenCalledWith(db, expect.stringContaining('INSERT INTO ims_settings'), ['tenant', 'feature_toggle_consignment_tracking', 'yes']);
    expect(mocks.execute.mock.calls.some(call => /UPDATE ims_consignment_events/.test(call[1]))).toBe(false);
  });
});
