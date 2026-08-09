import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockAccess, mockDbName, mockList, mockImsQuery, mockReport } = vi.hoisted(() => ({
  mockSession: vi.fn(), mockAccess: vi.fn(), mockDbName: vi.fn(), mockList: vi.fn(),
  mockImsQuery: vi.fn(), mockReport: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mockSession, assertBusinessAccess: mockAccess }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ getImsDbNameStrict: mockDbName }));
vi.mock('@/lib/xero/reconciliation/repository', () => ({ listXeroReconciliationIssues: mockList }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReport }));

import { GET, reconciliationIssuesCsv } from '../route';

describe('GET /api/xero/reconciliation/issues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Advisor' } });
    mockAccess.mockReturnValue(null);
    mockDbName.mockResolvedValue('tenant_ims');
    mockReport.mockResolvedValue(1);
    mockList.mockResolvedValue({ total: 1, items: [{
      id: 9, targetId: 4, targetType: 'purchase_order', referenceId: '42', xeroId: 'bill-42',
      ruleKey: 'total', severity: 'error', status: 'open', summary: 'Totals differ.',
      expected: { total: 10 }, actual: { total: 12 }, firstSeenAt: '2026-08-01',
      lastSeenAt: '2026-08-02', lastCheckedAt: '2026-08-02', occurrenceCount: 2,
      recommendedNextStep: 'Compare amounts.',
    }] });
    mockImsQuery.mockResolvedValue([{ id: 42, reference: 'PO-0042', contact_name: 'Supplier Ltd', amount: 10, item_date: '2026-07-01' }]);
  });

  it('allows an Advisor and enriches tenant references', async () => {
    const response = await GET(new Request('http://localhost/api/xero/reconciliation/issues?databaseId=biz-1&severity=error'));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1', severity: 'error' }));
    expect(mockImsQuery.mock.calls[0][2]).toBe('tenant_ims');
    expect(json.items[0]).toMatchObject({ reference: 'PO-0042', contactName: 'Supplier Ltd', amount: 10 });
  });

  it('blocks operational tiers before querying', async () => {
    mockSession.mockReturnValue({ user: { businessId: 'biz-1', tier: 'StandardUser' } });
    const response = await GET(new Request('http://localhost/api/xero/reconciliation/issues?databaseId=biz-1'));
    expect(response.status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('exports the same filtered rows as CSV', async () => {
    const response = await GET(new Request('http://localhost/api/xero/reconciliation/issues?databaseId=biz-1&format=csv&status=all'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(await response.text()).toContain('PO-0042');
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ status: 'all', limit: 500, offset: 0 }));
  });
});

describe('reconciliationIssuesCsv', () => {
  it('quotes cells and neutralizes spreadsheet formulas', () => {
    const csv = reconciliationIssuesCsv([{ reference: '=CMD()', contactName: 'A, B' } as any]);
    expect(csv).toContain("\"'=CMD()\"");
    expect(csv).toContain('"A, B"');
  });
});