import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRequireAdminSession,
  mockAssertBusinessAccess,
  mockExecute,
  mockQuery,
  mockXeroApiFetch,
} = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockExecute: vi.fn(),
  mockQuery: vi.fn(),
  mockXeroApiFetch: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  assertBusinessAccess: mockAssertBusinessAccess,
}));

vi.mock('@/services/MySQLService', () => ({
  execute: mockExecute,
  query: mockQuery,
}));

vi.mock('@/services/XeroService', () => ({
  xeroApiFetch: mockXeroApiFetch,
}));

import { POST } from '../route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/xero/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/xero/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { id: 'u1' }, response: null });
    mockAssertBusinessAccess.mockReturnValue(null);
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockResolvedValue([]);
    mockXeroApiFetch.mockResolvedValue({ Accounts: [] });
  });

  it('accepts gift_card_liability as a valid role and upserts mapping', async () => {
    const req = makeRequest({
      databaseId: 'biz-1',
      roleKey: 'gift_card_liability',
      xeroAccountId: 'acc-123',
      xeroAccountCode: '230',
      xeroAccountName: 'Gift Card Liability',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(1);

    const [, params] = mockExecute.mock.calls[0];
    expect(params).toEqual(['biz-1', 'gift_card_liability', 'acc-123', '230', 'Gift Card Liability']);
  });

  it('accepts store_credit_liability as a valid role and upserts mapping', async () => {
    const req = makeRequest({
      databaseId: 'biz-1',
      roleKey: 'store_credit_liability',
      xeroAccountId: 'acc-124',
      xeroAccountCode: '231',
      xeroAccountName: 'Store Credit Liability',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(1);

    const [, params] = mockExecute.mock.calls[0];
    expect(params).toEqual(['biz-1', 'store_credit_liability', 'acc-124', '231', 'Store Credit Liability']);
  });

  it('accepts rounding as a valid role and upserts mapping', async () => {
    const req = makeRequest({
      databaseId: 'biz-1',
      roleKey: 'rounding',
      xeroAccountId: 'acc-789',
      xeroAccountCode: '899',
      xeroAccountName: 'Cash Rounding',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(1);

    const [, params] = mockExecute.mock.calls[0];
    expect(params).toEqual(['biz-1', 'rounding', 'acc-789', '899', 'Cash Rounding']);
  });

  it('rejects an unknown role_key with 400', async () => {
    const req = makeRequest({
      databaseId: 'biz-1',
      roleKey: 'not_a_real_role',
      xeroAccountId: 'acc-999',
      xeroAccountCode: '999',
      xeroAccountName: 'Bogus',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(String(json.error)).toContain('Invalid role_key: not_a_real_role');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns auth/access response when access is denied', async () => {
    mockAssertBusinessAccess.mockReturnValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const req = makeRequest({
      databaseId: 'biz-1',
      roleKey: 'sales_revenue',
      xeroAccountId: 'acc-1',
      xeroAccountCode: '200',
      xeroAccountName: 'Sales',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Forbidden');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns 500 when DB upsert fails', async () => {
    mockExecute.mockRejectedValueOnce(new Error('db write failed'));

    const req = makeRequest({
      databaseId: 'biz-1',
      roleKey: 'sales_revenue',
      xeroAccountId: 'acc-2',
      xeroAccountCode: '200',
      xeroAccountName: 'Sales',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to save mapping.');
  });
});
