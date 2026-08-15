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
  ImsCNRepo: { get: mockGet, update: mockUpdate, delete: mockDelete },
}));
vi.mock('@/lib/ims/xeroHooks', () => ({ triggerCNXeroUpdate: mockXeroUpdate }));
vi.mock('@/services/XeroSyncService', () => ({ getXeroCreditNoteEditState: mockGetXeroCreditNoteEditState }));
vi.mock('@/lib/xero/reconciliation/repository', () => ({ recordXeroReconciliationIssue: mockRecordIssue }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { PUT } from '../route';

const params = { params: { id: '42' } };
function request(body: unknown) {
  return new Request('http://localhost/api/ims/credit-notes/42', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('PUT /api/ims/credit-notes/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin', userId: 7, name: 'Alex' });
    mockUpdate.mockResolvedValue(undefined);
    mockXeroUpdate.mockResolvedValue({ attempted: true, updated: true, warning: null });
    mockRecordIssue.mockResolvedValue(9);
    mockReportRuntimeIssue.mockResolvedValue(undefined);
  });

  it('keeps note-only edits local', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'draft', customer_id: 3, notes: 'old', xero_credit_note_id: 'xero-cn-1', items: [] });

    const response = await PUT(request({ notes: 'changed' }), params);

    expect(response.status).toBe(200);
    expect(mockGetXeroCreditNoteEditState).not.toHaveBeenCalled();
    expect(mockXeroUpdate).not.toHaveBeenCalled();
  });

  it('rejects linked return lines that have lost their source sales-order line', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'draft', customer_id: 3, so_id: 9, xero_credit_note_id: null, items: [] });

    const response = await PUT(request({ items: [{ qty: 1, unit_price: 10, tax_rate: 0.1 }] }), params);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('original sales-order line') });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('synchronously updates an editable linked Xero Draft', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'draft', customer_id: 3, xero_credit_note_id: 'xero-cn-1', items: [] });
    mockGetXeroCreditNoteEditState.mockResolvedValue({
      status: 'DRAFT', total: 20, remainingCredit: 20, documentDate: '2026-08-09', periodLockDate: '2026-06-30',
    });

    const response = await PUT(request({ customer_id: 4 }), params);

    expect(response.status).toBe(200);
    expect(mockXeroUpdate).toHaveBeenCalledWith('biz-1', 42);
  });

  it('blocks an Authorised Xero credit note without an override reason', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'draft', customer_id: 3, xero_credit_note_id: 'xero-cn-1', items: [] });
    mockGetXeroCreditNoteEditState.mockResolvedValue({
      status: 'AUTHORISED', total: 20, remainingCredit: 20, documentDate: '2026-08-09',
    });

    const response = await PUT(request({ customer_id: 4 }), params);

    expect(response.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('records a reasoned Admin override without changing Xero', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'draft', customer_id: 3, xero_credit_note_id: 'xero-cn-1', items: [] });
    mockGetXeroCreditNoteEditState.mockResolvedValue({
      status: 'AUTHORISED', total: 20, remainingCredit: 20, documentDate: '2026-08-09',
    });

    const response = await PUT(request({ customer_id: 4, xeroOverrideReason: 'Bookkeeper approved correction' }), params);

    expect(response.status).toBe(200);
    expect(mockXeroUpdate).not.toHaveBeenCalled();
    expect(mockRecordIssue).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'customer_credit_note', ruleKey: 'admin_edit_override', eventType: 'override',
      actorId: 7, reason: 'Bookkeeper approved correction',
    }));
  });
});