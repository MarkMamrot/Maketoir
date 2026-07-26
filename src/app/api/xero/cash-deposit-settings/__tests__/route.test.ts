import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminTier, mockAssertBusinessAccess, mockImsQuery, mockExecute, mockQuery, mockXeroFetch } = vi.hoisted(() => ({
  mockRequireAdminTier: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockImsQuery: vi.fn(),
  mockExecute: vi.fn(),
  mockQuery: vi.fn(),
  mockXeroFetch: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminTier: mockRequireAdminTier,
  assertBusinessAccess: mockAssertBusinessAccess,
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/services/MySQLService', () => ({ execute: mockExecute, query: mockQuery }));
vi.mock('@/services/XeroService', () => ({ xeroApiFetch: mockXeroFetch }));

import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/xero/cash-deposit-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/xero/cash-deposit-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminTier.mockReturnValue({ user: { businessId: 'biz-1' } });
    mockAssertBusinessAccess.mockReturnValue(null);
    mockImsQuery.mockResolvedValue([{ id: 4 }]);
    mockExecute.mockResolvedValue({ affectedRows: 1 });
  });

  it('saves an active Xero bank account for a tenant location', async () => {
    mockXeroFetch.mockResolvedValue({ Accounts: [{
      AccountID: 'bank-1', Code: '100', Name: 'Trading Account', Type: 'BANK', Status: 'ACTIVE',
    }] });

    const response = await POST(request({
      databaseId: 'biz-1', locationId: 4, xeroAccountId: 'bank-1', xeroAccountCode: '100',
    }));

    expect(response.status).toBe(200);
    expect(mockImsQuery).toHaveBeenCalledWith(expect.any(String), [4, 'biz-1']);
    expect(mockExecute.mock.calls[0][1]).toEqual(['biz-1', 4, 'bank-1', '100', 'Trading Account']);
  });

  it('rejects a non-bank account even when it accepts payments', async () => {
    mockXeroFetch.mockResolvedValue({ Accounts: [{
      AccountID: 'asset-1', Code: '101', Name: 'Clearing', Type: 'CURRENT',
      Status: 'ACTIVE', EnablePaymentsToAccount: true,
    }] });

    const response = await POST(request({
      databaseId: 'biz-1', locationId: 4, xeroAccountId: 'asset-1', xeroAccountCode: '101',
    }));

    expect(response.status).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects a location outside the authenticated business', async () => {
    mockImsQuery.mockResolvedValue([]);

    const response = await POST(request({
      databaseId: 'biz-1', locationId: 9, xeroAccountId: 'bank-1', xeroAccountCode: '100',
    }));

    expect(response.status).toBe(404);
    expect(mockXeroFetch).not.toHaveBeenCalled();
  });
});