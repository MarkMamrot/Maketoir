import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), execute: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute, getIMSPool: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET } from '../route';

describe('Daybook task materialization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'test-business', location_id: 2, tier: 'PosUser' });
    mocks.query.mockImplementation(async (sql: string) => sql.includes('SELECT id, name FROM ims_locations') ? [{ id: 2, name: 'Test store' }] : []);
    mocks.execute.mockResolvedValue({ affectedRows: 0 });
  });

  it('retries an idempotent insert after a deadlock and loads the workspace', async () => {
    mocks.execute.mockRejectedValueOnce(Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' }));
    const response = await GET(new Request('http://localhost/api/pos/daybook?date=2026-10-07'));
    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledTimes(8);
    expect(mocks.execute.mock.calls[0]).toEqual(mocks.execute.mock.calls[1]);
    expect(mocks.execute.mock.calls[0][0]).toContain('ORDER BY id');
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('reports a persistent deadlock after three attempts', async () => {
    mocks.execute.mockRejectedValue(Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' }));
    const response = await GET(new Request('http://localhost/api/pos/daybook?date=2026-10-07'));
    expect(response.status).toBe(500);
    expect(mocks.execute).toHaveBeenCalledTimes(3);
    expect(mocks.report).toHaveBeenCalledOnce();
  });

  it('does not retry unrelated database failures', async () => {
    mocks.execute.mockRejectedValue(Object.assign(new Error('missing table'), { code: 'ER_NO_SUCH_TABLE' }));
    const response = await GET(new Request('http://localhost/api/pos/daybook?date=2026-10-07'));
    expect(response.status).toBe(500);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.report).toHaveBeenCalledOnce();
  });
});