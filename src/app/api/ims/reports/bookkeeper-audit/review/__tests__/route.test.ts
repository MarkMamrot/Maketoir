import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), accept: vi.fn(), undo: vi.fn(), ignoreXero: vi.fn(), reopenXero: vi.fn(), report: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mocks.session }));
vi.mock('@/lib/ims/bookkeeperAudit/repository', () => ({
  acceptAuditFinding: mocks.accept, undoAuditFindingAcceptance: mocks.undo,
}));
vi.mock('@/lib/xero/reconciliation/repository', () => ({
  ignoreXeroReconciliationIssue: mocks.ignoreXero,
  reopenIgnoredXeroReconciliationIssue: mocks.reopenXero,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/ims/reports/bookkeeper-audit/review', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/ims/reports/bookkeeper-audit/review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Advisor', userId: 7, name: 'Alex' } });
    mocks.accept.mockResolvedValue(4);
    mocks.undo.mockResolvedValue(true);
    mocks.ignoreXero.mockResolvedValue(true);
    mocks.reopenXero.mockResolvedValue(true);
    mocks.report.mockResolvedValue(1);
  });

  it('stores a generic accepted exception in the audit review repository', async () => {
    const fingerprint = 'a'.repeat(64);
    const response = await POST(request({
      action: 'accept', findingKey: 'stock:v1:3:negative', fingerprint, reason: 'Count scheduled',
    }));
    expect(response.status).toBe(200);
    expect(mocks.accept).toHaveBeenCalledWith({
      businessId: 'biz-1', findingKey: 'stock:v1:3:negative', fingerprint,
      reason: 'Count scheduled', actorId: 7, actorName: 'Alex',
    });
    expect(mocks.ignoreXero).not.toHaveBeenCalled();
  });

  it('routes Xero acceptance and undo through the reconciliation issue lifecycle', async () => {
    const fingerprint = 'b'.repeat(64);
    expect((await POST(request({ action: 'accept', findingKey: 'xero:9', fingerprint, reason: 'Known timing difference' }))).status).toBe(200);
    expect(mocks.ignoreXero).toHaveBeenCalledWith({
      businessId: 'biz-1', issueId: 9, expectedFingerprint: fingerprint,
      reason: 'Known timing difference', actorId: 7, actorName: 'Alex',
    });

    expect((await POST(request({ action: 'undo', findingKey: 'xero:9', fingerprint }))).status).toBe(200);
    expect(mocks.reopenXero).toHaveBeenCalledWith({
      businessId: 'biz-1', issueId: 9, expectedFingerprint: fingerprint, actorId: 7, actorName: 'Alex',
    });
  });

  it('returns conflict when the Xero issue no longer matches the displayed evidence', async () => {
    mocks.ignoreXero.mockResolvedValue(false);
    const response = await POST(request({
      action: 'accept', findingKey: 'xero:9', fingerprint: 'c'.repeat(64), reason: 'Reviewed',
    }));
    expect(response.status).toBe(409);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
});