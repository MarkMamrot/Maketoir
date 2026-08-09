import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), getContext: vi.fn(), recordEvent: vi.fn(), imsQuery: vi.fn(),
  triggerPO: vi.fn(), triggerSO: vi.fn(), triggerCN: vi.fn(), triggerSCN: vi.fn(),
  approveBill: vi.fn(), approveInvoice: vi.fn(), approveCreditNote: vi.fn(), report: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mocks.session, assertBusinessAccess: mocks.access }));
vi.mock('@/lib/xero/reconciliation/repository', () => ({
  getXeroReconciliationIssueActionContext: mocks.getContext,
  recordXeroReconciliationActionEvent: mocks.recordEvent,
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/lib/ims/xeroHooks', () => ({
  triggerPOXeroSync: mocks.triggerPO, triggerSOXeroSync: mocks.triggerSO,
  triggerCNXeroSync: mocks.triggerCN, triggerSupplierCNXeroSync: mocks.triggerSCN,
}));
vi.mock('@/services/XeroSyncService', () => ({
  approveBill: mocks.approveBill, approveInvoice: mocks.approveInvoice, approveCreditNote: mocks.approveCreditNote,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/xero/reconciliation/issues/9/action', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/xero/reconciliation/issues/[id]/action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Admin', userId: 7, name: 'Alex' } });
    mocks.access.mockReturnValue(null);
    mocks.getContext.mockResolvedValue({
      issueId: 9, status: 'open', ruleKey: 'total', targetType: 'purchase_order',
      referenceId: '42', xeroId: 'bill-42',
    });
    mocks.imsQuery.mockResolvedValue([{ status: 'complete' }]);
    mocks.triggerPO.mockResolvedValue(undefined);
    mocks.recordEvent.mockResolvedValue(undefined);
    mocks.approveBill.mockResolvedValue(true);
    mocks.approveInvoice.mockResolvedValue(true);
    mocks.approveCreditNote.mockResolvedValue(true);
    mocks.report.mockResolvedValue(1);
  });

  it('retries through the policy-aware local document hook and records the actor', async () => {
    const response = await POST(request({ databaseId: 'biz-1', action: 'retry' }), { params: { id: '9' } });
    expect(response.status).toBe(200);
    expect(mocks.triggerPO).toHaveBeenCalledWith('biz-1', 42, 'complete');
    expect(mocks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', issueId: 9, actorId: 7, actorName: 'Alex', action: 'retry',
      targetType: 'purchase_order', referenceId: 42, xeroId: 'bill-42',
    }));
  });

  it('blocks Advisor from all accounting actions', async () => {
    mocks.session.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Advisor', userId: 8, name: 'Pat' } });
    const response = await POST(request({ databaseId: 'biz-1', action: 'retry' }), { params: { id: '9' } });
    expect(response.status).toBe(403);
    expect(mocks.getContext).not.toHaveBeenCalled();
  });

  it('requires a reason before authorising', async () => {
    const response = await POST(request({ databaseId: 'biz-1', action: 'authorise', reason: '  ' }), { params: { id: '9' } });
    expect(response.status).toBe(400);
    expect(mocks.approveBill).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('authorises only a linked lifecycle issue and records the reason', async () => {
    mocks.getContext.mockResolvedValue({
      issueId: 9, status: 'open', ruleKey: 'lifecycle_state', targetType: 'sales_order',
      referenceId: '42', xeroId: 'invoice-42',
    });
    const response = await POST(request({ databaseId: 'biz-1', action: 'authorise', reason: 'Approved after review' }), { params: { id: '9' } });
    expect(response.status).toBe(200);
    expect(mocks.approveInvoice).toHaveBeenCalledWith('biz-1', 'invoice-42', 42);
    expect(mocks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'authorise', reason: 'Approved after review' }));
  });

  it('rejects authorise for a non-lifecycle discrepancy', async () => {
    const response = await POST(request({ databaseId: 'biz-1', action: 'authorise', reason: 'Approved' }), { params: { id: '9' } });
    expect(response.status).toBe(409);
    expect(mocks.approveBill).not.toHaveBeenCalled();
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });
});