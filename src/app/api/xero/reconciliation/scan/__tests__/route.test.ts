import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireSession, mockAssertAccess, mockScan, mockReportIssue } = vi.hoisted(() => ({
  mockRequireSession: vi.fn(), mockAssertAccess: vi.fn(), mockScan: vi.fn(), mockReportIssue: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireSession,
  assertBusinessAccess: mockAssertAccess,
}));
vi.mock('@/lib/xero/reconciliation/scanner', () => ({ scanXeroReconciliationTargets: mockScan }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportIssue }));

import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/xero/reconciliation/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/xero/reconciliation/scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Admin' } });
    mockAssertAccess.mockReturnValue(null);
    mockReportIssue.mockResolvedValue(undefined);
    mockScan.mockResolvedValue({
      targetCount: 10, checkedCount: 10, mismatchCount: 2, failedBatches: 0,
      unsupportedCount: 0, nextCursor: 10, hasMore: false,
    });
  });

  it.each(['Admin', 'SuperAdmin', 'Advisor'])('allows %s to run a bounded tenant scan', async tier => {
    mockRequireSession.mockReturnValue({ user: { businessId: 'biz-1', tier } });

    const response = await POST(request({ databaseId: 'biz-1', afterId: 4, limit: 1000 }));

    expect(response.status).toBe(200);
    expect(mockScan).toHaveBeenCalledWith({ businessId: 'biz-1', afterId: 4, limit: 500 });
  });

  it('blocks operational user tiers before scanning', async () => {
    mockRequireSession.mockReturnValue({ user: { businessId: 'biz-1', tier: 'StandardUser' } });

    const response = await POST(request({ databaseId: 'biz-1' }));

    expect(response.status).toBe(403);
    expect(mockScan).not.toHaveBeenCalled();
  });

  it('enforces business access before scanning', async () => {
    mockAssertAccess.mockReturnValue(new Response(JSON.stringify({ error: 'Not authorised.' }), { status: 403 }));

    const response = await POST(request({ databaseId: 'biz-2' }));

    expect(response.status).toBe(403);
    expect(mockScan).not.toHaveBeenCalled();
  });
});