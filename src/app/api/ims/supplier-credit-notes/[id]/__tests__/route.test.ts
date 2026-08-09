import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSession, mockGet, mockUpdate, mockDelete, mockXeroUpdate,
  mockGetXeroCreditNoteEditState, mockRecordIssue, mockReportRuntimeIssue,
} = vi.hoisted(() => ({
  mockSession: vi.fn(), mockGet: vi.fn(), mockUpdate: vi.fn(), mockDelete: vi.fn(), mockXeroUpdate: vi.fn(),
  mockGetXeroCreditNoteEditState: vi.fn(), mockRecordIssue: vi.fn(), mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsSupplierCNRepo: { get: mockGet, update: mockUpdate, delete: mockDelete },
}));
vi.mock('@/lib/ims/xeroHooks', () => ({ triggerSupplierCNXeroUpdate: mockXeroUpdate }));
vi.mock('@/services/XeroSyncService', () => ({ getXeroCreditNoteEditState: mockGetXeroCreditNoteEditState }));
vi.mock('@/lib/xero/reconciliation/repository', () => ({ recordXeroReconciliationIssue: mockRecordIssue }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { PUT } from '../route';

const params = { params: { id: '52' } };
function request(body: unknown) {
  return new Request('http://localhost/api/ims/supplier-credit-notes/52', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('PUT /api/ims/supplier-credit-notes/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin', userId: 7, name: 'Alex' });
    mockUpdate.mockResolvedValue(undefined);
    mockXeroUpdate.mockResolvedValue({ attempted: true, updated: true, warning: null });
    mockRecordIssue.mockResolvedValue(9);
    mockReportRuntimeIssue.mockResolvedValue(undefined);
  });

  it('blocks a Xero-visible edit in a locked period', async () => {
    mockGet.mockResolvedValue({ id: 52, status: 'draft', supplier_id: 3, xero_credit_note_id: 'xero-scn-1', items: [] });
    mockGetXeroCreditNoteEditState.mockResolvedValue({
      status: 'DRAFT', total: 20, remainingCredit: 20, documentDate: '2026-06-30', periodLockDate: '2026-06-30',
    });

    const response = await PUT(request({ supplier_id: 4 }), params);

    expect(response.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns and records a warning when the post-save Xero update fails', async () => {
    mockGet.mockResolvedValue({ id: 52, status: 'draft', supplier_id: 3, xero_credit_note_id: 'xero-scn-1', items: [] });
    mockGetXeroCreditNoteEditState.mockResolvedValue({
      status: 'DRAFT', total: 20, remainingCredit: 20, documentDate: '2026-08-09',
    });
    mockXeroUpdate.mockResolvedValue({ attempted: true, updated: false, warning: 'Saved, but Xero failed.' });

    const response = await PUT(request({ supplier_id: 4 }), params);

    expect(await response.json()).toMatchObject({ success: true, xeroWarning: 'Saved, but Xero failed.' });
    expect(mockRecordIssue).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'supplier_credit_note', ruleKey: 'post_edit_sync_failed',
    }));
  });

  it('keeps Advisor accounts read-only', async () => {
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });

    const response = await PUT(request({ notes: 'changed' }), params);

    expect(response.status).toBe(403);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});