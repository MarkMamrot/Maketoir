import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  get: vi.fn(),
  undo: vi.fn(),
  refresh: vi.fn(),
  xeroState: vi.fn(),
  xeroVoid: vi.fn(),
  report: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsPORepo: { get: mocks.get, undoCompletedReceipt: mocks.undo },
}));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: mocks.refresh }));
vi.mock('@/services/XeroSyncService', () => ({ getXeroInvoiceEditState: mocks.xeroState }));
vi.mock('@/lib/ims/xeroHooks', () => ({ triggerPOXeroVoid: mocks.xeroVoid }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/xero/reconciliation/repository', () => ({ recordXeroReconciliationIssue: mocks.reconcile }));

import { POST } from '../route';

const params = { params: { id: '42' } };
const revision = '2026-08-11T10:00:00.000Z';

function request(body: unknown) {
  return new Request('http://localhost/api/ims/purchase-orders/42/undo-receipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ims/purchase-orders/[id]/undo-receipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin', userId: 7, name: 'Alex' });
    mocks.get.mockResolvedValue({
      id: 42,
      status: 'complete',
      is_historical: 0,
      updated_at: revision,
      xero_bill_id: null,
      items: [{ variant_id: 'v-1' }],
    });
    mocks.undo.mockResolvedValue({ replayed: false });
    mocks.refresh.mockResolvedValue(undefined);
    mocks.xeroVoid.mockResolvedValue(null);
    mocks.report.mockResolvedValue(null);
    mocks.reconcile.mockResolvedValue(9);
  });

  it('requires stable operation and revision keys', async () => {
    const response = await POST(request({ operationKey: 'undo-42' }), params);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: 'operationKey and expectedUpdatedAt are required.',
    });
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('blocks a settled linked Xero bill before local mutation', async () => {
    mocks.get.mockResolvedValue({
      id: 42,
      status: 'complete',
      is_historical: 0,
      updated_at: revision,
      xero_bill_id: 'xero-1',
      items: [],
    });
    mocks.xeroState.mockResolvedValue({
      status: 'AUTHORISED', amountPaid: 10, amountCredited: 0, documentDate: '2026-08-11',
      periodLockDate: null, endOfYearLockDate: null,
    });

    const response = await POST(request({ operationKey: 'undo-42', expectedUpdatedAt: revision }), params);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.code).toBe('order_correction_conflict');
    expect(json.blockers).toEqual([expect.objectContaining({ code: 'xero_settled' })]);
    expect(mocks.undo).not.toHaveBeenCalled();
    expect(mocks.xeroVoid).not.toHaveBeenCalled();
  });

  it('passes a deterministic hash and actor to the replay-safe transaction', async () => {
    mocks.undo.mockResolvedValue({ replayed: true });

    const response = await POST(request({ operationKey: 'undo-42', expectedUpdatedAt: revision }), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, replayed: true });
    expect(mocks.undo).toHaveBeenCalledWith(42, 'biz-1', revision, {
      operationKey: 'undo-42',
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      expectedUpdatedAt: revision,
      actorId: 7,
      actorName: 'Alex',
    });
    expect(mocks.refresh).toHaveBeenCalledWith(['v-1']);
  });

  it('preserves local success and records recovery evidence when Xero void fails', async () => {
    mocks.get.mockResolvedValue({
      id: 42,
      status: 'complete',
      is_historical: 0,
      updated_at: revision,
      xero_bill_id: 'xero-1',
      items: [],
    });
    mocks.xeroState.mockResolvedValue({
      status: 'AUTHORISED', amountPaid: 0, amountCredited: 0, documentDate: '2026-08-11',
      periodLockDate: null, endOfYearLockDate: null,
    });
    mocks.xeroVoid.mockResolvedValue('Please void the linked bill manually in Xero.');

    const response = await POST(request({ operationKey: 'undo-42', expectedUpdatedAt: revision }), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      success: true,
      replayed: false,
      xeroWarning: 'Please void the linked bill manually in Xero.',
    });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'undo_receipt_xero_void' }));
    expect(mocks.reconcile).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      referenceId: 42,
      xeroId: 'xero-1',
      ruleKey: 'receipt_undo_void_failed',
    }));
  });
});