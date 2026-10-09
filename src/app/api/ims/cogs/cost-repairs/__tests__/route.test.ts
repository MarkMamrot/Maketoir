import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, getPool, calculate, report, connection } = vi.hoisted(() => {
  const connection = {
    beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  };
  return { getSession: vi.fn(), getPool: vi.fn(() => ({ getConnection: vi.fn().mockResolvedValue(connection) })),
    calculate: vi.fn(), report: vi.fn(), connection };
});

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: getSession }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: getPool, imsQuery: vi.fn() }));
vi.mock('@/lib/xero/cogsCalculator', () => ({ calculateCogsForPeriod: calculate }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: report }));

import { POST } from '../route';

function request(repairs: unknown) {
  return new Request('http://localhost/api/ims/cogs/cost-repairs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '2026-07-01', toExclusive: '2026-08-01', repairs }),
  });
}

const repair = { movementId: 17, expectedUnitCost: null, newUnitCost: 12.5, source: 'cost_aud',
  sourceDetail: { costAud: 12.5 }, reason: 'Reviewed original supplier invoice', fifoWarningAccepted: false };

describe('POST /api/ims/cogs/cost-repairs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connection.beginTransaction.mockResolvedValue(undefined);
    connection.commit.mockResolvedValue(undefined);
    connection.rollback.mockResolvedValue(undefined);
    getSession.mockResolvedValue({ businessId: 'biz-1', userId: 4, name: 'A User', tier: 'Admin' });
    connection.execute.mockImplementation((sql: string) => {
      if (sql.includes('SELECT sm.id')) return Promise.resolve([[{ id: 17, unit_cost: null, cost_method_snapshot: 'average_cost', created_at: '2026-07-15 10:00:00' }], []]);
      return Promise.resolve([{ affectedRows: 1 }, []]);
    });
    calculate.mockResolvedValue({ totalCOGS: 125, blocked: false });
  });

  it('rejects read-only Advisor sessions before opening a transaction', async () => {
    getSession.mockResolvedValueOnce({ businessId: 'biz-1', tier: 'Advisor' });
    expect((await POST(request([repair]))).status).toBe(403);
    expect(getPool).not.toHaveBeenCalled();
  });

  it('writes the audit row and movement cost in one transaction', async () => {
    const response = await POST(request([repair]));
    expect(response.status).toBe(200);
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.execute.mock.calls[1][0]).toContain('INSERT INTO ims_cogs_cost_repairs');
    expect(connection.execute.mock.calls[2][0]).toContain('UPDATE ims_stock_movements SET unit_cost');
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ success: true, repaired: 1 });
  });

  it('rolls back a FIFO repair without explicit acknowledgement', async () => {
    connection.execute.mockResolvedValueOnce([[{ id: 17, unit_cost: null, cost_method_snapshot: 'fifo', created_at: '2026-07-15 10:00:00' }], []]);
    const response = await POST(request([repair]));
    expect(response.status).toBe(409);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});