import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRequireAdminSession,
  mockAssertBusinessAccess,
  mockExecute,
  mockQuery,
  mockImsQuery,
  mockConfigGet,
  mockXeroApiFetch,
} = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockExecute: vi.fn(),
  mockQuery: vi.fn(),
  mockImsQuery: vi.fn(),
  mockConfigGet: vi.fn(),
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

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/db/ConfigRepository', () => ({ ConfigRepository: { get: mockConfigGet } }));
vi.mock('@/services/XeroService', () => ({ xeroApiFetch: mockXeroApiFetch }));

import { GET, POST } from '../route';

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/xero/pos-payment-mappings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/xero/pos-payment-mappings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'biz-1' }, response: null });
    mockAssertBusinessAccess.mockReturnValue(null);
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockResolvedValue([]);
    mockImsQuery.mockResolvedValue([]);
    mockConfigGet.mockResolvedValue(JSON.stringify(['Cash', 'Card', 'card']));
    mockXeroApiFetch.mockResolvedValue({ Accounts: [] });
  });

  it('returns active locations, deduplicated methods and existing mappings', async () => {
    mockImsQuery.mockResolvedValueOnce([{ id: 2, name: 'Newtown' }]);
    mockQuery.mockResolvedValueOnce([{
      ims_location_id: 2,
      payment_method: 'Card',
      xero_account_id: 'bank-1',
      xero_account_code: '091',
      xero_account_name: 'Newtown Card Clearing',
    }]);

    const response = await GET(new Request('http://localhost/api/xero/pos-payment-mappings?databaseId=biz-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.methods).toEqual([{ payment_method: 'Cash' }, { payment_method: 'Card' }]);
    expect(body.locations).toEqual([{ id: 2, name: 'Newtown' }]);
    expect(body.mappings[0].xero_account_code).toBe('091');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('xero_pos_clearing_mappings'), ['biz-1']);
  });

  it('upserts the canonical method and server-validated active bank account', async () => {
    mockImsQuery.mockResolvedValueOnce([{ id: 2 }]);
    mockXeroApiFetch.mockResolvedValueOnce({ Accounts: [{
      AccountID: 'bank-1', Code: '091', Name: 'Newtown Card Clearing', Type: 'BANK', Status: 'ACTIVE',
    }] });

    const response = await POST(postRequest({
      databaseId: 'biz-1', locationId: 2, paymentMethod: ' card ',
      xeroAccountId: 'bank-1', xeroAccountCode: '091',
    }));

    expect(response.status).toBe(200);
    const upsert = mockExecute.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO xero_pos_clearing_mappings'));
    expect(upsert?.[1]).toEqual(['biz-1', 2, 'Card', 'bank-1', '091', 'Newtown Card Clearing']);
  });

  it('rejects a location outside the authenticated business', async () => {
    mockImsQuery.mockResolvedValueOnce([]);

    const response = await POST(postRequest({
      databaseId: 'biz-1', locationId: 99, paymentMethod: 'Card',
      xeroAccountId: 'bank-1', xeroAccountCode: '091',
    }));

    expect(response.status).toBe(404);
    expect(mockXeroApiFetch).not.toHaveBeenCalled();
  });

  it('rejects an inactive or non-bank Xero account', async () => {
    mockImsQuery.mockResolvedValueOnce([{ id: 2 }]);
    mockXeroApiFetch.mockResolvedValueOnce({ Accounts: [{
      AccountID: 'sales-1', Code: '200', Name: 'Sales', Type: 'REVENUE', Status: 'ACTIVE',
    }] });

    const response = await POST(postRequest({
      databaseId: 'biz-1', locationId: 2, paymentMethod: 'Card',
      xeroAccountId: 'sales-1', xeroAccountCode: '200',
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('active Xero account that accepts payments');
    expect(mockExecute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))).toBe(false);
  });

  it('accepts a Xero bank account even when the optional payment flag is false', async () => {
    mockImsQuery.mockResolvedValueOnce([{ id: 2 }]);
    mockXeroApiFetch.mockResolvedValueOnce({ Accounts: [{
      AccountID: 'bank-2', Code: '092', Name: 'Locked Bank', Type: 'BANK', Status: 'ACTIVE', EnablePaymentsToAccount: false,
    }] });

    const response = await POST(postRequest({
      databaseId: 'biz-1', locationId: 2, paymentMethod: 'Card',
      xeroAccountId: 'bank-2', xeroAccountCode: '092',
    }));

    expect(response.status).toBe(200);
    expect(mockExecute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO xero_pos_clearing_mappings'))).toBe(true);
  });

  it('accepts a non-bank clearing account that Xero explicitly enables for payments', async () => {
    mockImsQuery.mockResolvedValueOnce([{ id: 2 }]);
    mockXeroApiFetch.mockResolvedValueOnce({ Accounts: [{
      AccountID: 'clearing-1', Code: '610', Name: 'Card Clearing', Type: 'CURRENT', Status: 'ACTIVE', EnablePaymentsToAccount: true,
    }] });

    const response = await POST(postRequest({
      databaseId: 'biz-1', locationId: 2, paymentMethod: 'Card',
      xeroAccountId: 'clearing-1', xeroAccountCode: '610',
    }));

    expect(response.status).toBe(200);
    const upsert = mockExecute.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO xero_pos_clearing_mappings'));
    expect(upsert?.[1]).toEqual(['biz-1', 2, 'Card', 'clearing-1', '610', 'Card Clearing']);
  });

  it('removes one location and method cell without calling Xero', async () => {
    mockImsQuery.mockResolvedValueOnce([{ id: 2 }]);

    const response = await POST(postRequest({ databaseId: 'biz-1', locationId: 2, paymentMethod: 'cash' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.removed).toBe(true);
    const deletion = mockExecute.mock.calls.find(([sql]) => String(sql).includes('DELETE FROM xero_pos_clearing_mappings'));
    expect(deletion?.[1]).toEqual(['biz-1', 2, 'cash']);
    expect(mockXeroApiFetch).not.toHaveBeenCalled();
  });

  it('returns the access denial response before querying data', async () => {
    mockAssertBusinessAccess.mockReturnValueOnce(new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }));

    const response = await GET(new Request('http://localhost/api/xero/pos-payment-mappings?databaseId=other'));

    expect(response.status).toBe(403);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockImsQuery).not.toHaveBeenCalled();
  });
});