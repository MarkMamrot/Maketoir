import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockAccess, mockIgnore, mockReport } = vi.hoisted(() => ({
  mockSession: vi.fn(), mockAccess: vi.fn(), mockIgnore: vi.fn(), mockReport: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mockSession, assertBusinessAccess: mockAccess }));
vi.mock('@/lib/xero/reconciliation/repository', () => ({ ignoreXeroReconciliationIssue: mockIgnore }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReport }));

import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/xero/reconciliation/issues/9/ignore', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/xero/reconciliation/issues/[id]/ignore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Advisor', userId: 7, name: 'Alex' } });
    mockAccess.mockReturnValue(null);
    mockIgnore.mockResolvedValue(true);
    mockReport.mockResolvedValue(1);
  });

  it.each(['Admin', 'SuperAdmin', 'Advisor'])('allows %s to ignore with actor and reason', async tier => {
    mockSession.mockReturnValue({ user: { businessId: 'biz-1', tier, userId: 7, name: 'Alex' } });
    const response = await POST(request({ databaseId: 'biz-1', reason: 'Accepted by the bookkeeper' }), { params: { id: '9' } });
    expect(response.status).toBe(200);
    expect(mockIgnore).toHaveBeenCalledWith({
      businessId: 'biz-1', issueId: 9, actorId: 7, actorName: 'Alex', reason: 'Accepted by the bookkeeper',
    });
  });

  it('rejects a blank reason as validation, not a runtime issue', async () => {
    const response = await POST(request({ databaseId: 'biz-1', reason: '  ' }), { params: { id: '9' } });
    expect(response.status).toBe(400);
    expect(mockIgnore).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('returns not found when the issue is absent or no longer open', async () => {
    mockIgnore.mockResolvedValue(false);
    const response = await POST(request({ databaseId: 'biz-1', reason: 'Accepted' }), { params: { id: '9' } });
    expect(response.status).toBe(404);
  });

  it('blocks operational tiers before mutation', async () => {
    mockSession.mockReturnValue({ user: { businessId: 'biz-1', tier: 'StandardUser', userId: 8, name: 'Sam' } });
    const response = await POST(request({ databaseId: 'biz-1', reason: 'Accepted' }), { params: { id: '9' } });
    expect(response.status).toBe(403);
    expect(mockIgnore).not.toHaveBeenCalled();
  });
});