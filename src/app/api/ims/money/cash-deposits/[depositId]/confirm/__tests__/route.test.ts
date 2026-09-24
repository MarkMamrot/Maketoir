import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRequireAdminTier,
  mockGetBusinessTimeZone,
  mockXeroApiFetch,
  mockGetPool,
} = vi.hoisted(() => ({
  mockRequireAdminTier: vi.fn(),
  mockGetBusinessTimeZone: vi.fn(),
  mockXeroApiFetch: vi.fn(),
  mockGetPool: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mockRequireAdminTier }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: mockGetBusinessTimeZone }));
vi.mock('@/services/XeroService', () => ({ xeroApiFetch: mockXeroApiFetch }));
vi.mock('@/services/MySQLService', () => ({ getPool: mockGetPool }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));

import { POST } from '../route';

const context = { params: { depositId: '7' } };

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/ims/money/cash-deposits/7/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function connection() {
  const execute = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT id, counted_total')) {
      return [[{
        id: 7,
        counted_total: '100.00',
        over_short_account_code: '898',
        confirmation_status: 'planned',
        accounting_method: 'solvantis',
        status: 'draft',
        lodgement_date: null,
        bank_reference: null,
        notes: null,
        destination_account_id: null,
        deposited_total: null,
      }]];
    }
    if (sql.includes('SELECT business_date, banking_variance')) {
      return [[{ business_date: '2026-09-20', banking_variance: '0.00' }]];
    }
    return [{ affectedRows: 1 }];
  });
  return {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    execute,
  };
}

describe('POST /api/ims/money/cash-deposits/[depositId]/confirm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T02:00:00.000Z'));
    vi.clearAllMocks();
    mockRequireAdminTier.mockReturnValue({
      user: { businessId: 'biz-1', userId: 4, name: 'Admin' },
      response: null,
    });
    mockGetBusinessTimeZone.mockResolvedValue('Australia/Sydney');
    mockXeroApiFetch.mockResolvedValue({
      Accounts: [{ AccountID: 'bank-1', Code: '11110', Name: 'Trading Bank', Type: 'BANK', Status: 'ACTIVE' }],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('records a historical deposit as already entered in Xero without creating Xero actions', async () => {
    const db = connection();
    mockGetPool.mockReturnValue({ getConnection: vi.fn().mockResolvedValue(db) });

    const response = await POST(request({
      lodgementDate: '2026-09-20',
      bankReference: 'DEP-1042',
      destinationAccountId: 'bank-1',
      depositedTotal: 100,
      accountingMethod: 'recorded_externally',
      notes: 'The bookkeeper entered this deposit manually in Xero on 20 September.',
    }), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accountingMethod: 'recorded_externally' });
    const statements = db.execute.mock.calls.map(call => String(call[0]));
    expect(statements.some(sql => sql.includes("status = ?"))).toBe(true);
    expect(statements.some(sql => sql.includes('INSERT INTO xero_cash_deposit_actions'))).toBe(false);
    expect(db.commit).toHaveBeenCalledOnce();
  });

  it('rejects a future lodgement before validating Xero or opening a transaction', async () => {
    const response = await POST(request({
      lodgementDate: '2026-09-25',
      bankReference: '',
      destinationAccountId: 'bank-1',
      depositedTotal: 100,
      accountingMethod: 'solvantis',
      notes: '',
    }), context);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('future') });
    expect(mockXeroApiFetch).not.toHaveBeenCalled();
    expect(mockGetPool).not.toHaveBeenCalled();
  });
});
