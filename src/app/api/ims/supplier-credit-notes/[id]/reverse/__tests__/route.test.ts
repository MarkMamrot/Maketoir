import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), execute: vi.fn(), get: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/creditNotes/creditNoteReversalWorkflow', () => ({ executeCreditNoteReversalWorkflow: mocks.execute }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsSupplierCNRepo: { get: mocks.get } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';
import { CreditNoteReversalConflict } from '@/lib/ims/creditNotes/creditNoteCorrections';

const params = { params: { id: '23' } };
function request(body: unknown) {
  return new Request('http://localhost/api/ims/supplier-credit-notes/23/reverse', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/ims/supplier-credit-notes/[id]/reverse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin', userId: 8, email: 'sam@example.com' });
    mocks.execute.mockResolvedValue({ id: 23, status: 'reversed', replayed: false, xeroCorrectionStatus: 'error', xeroWarning: 'Retry Xero.' });
    mocks.get.mockResolvedValue({ id: 23, status: 'reversed' });
  });

  it('returns local success with a visible Xero warning', async () => {
    const response = await POST(request({ operationKey: 'stable-key', expectedUpdatedAt: 'revision', reason: 'Wrong supplier note' }), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, xeroWarning: 'Retry Xero.', data: { status: 'reversed' } });
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'supplier_credit_note', context: expect.objectContaining({ actorId: 8, actorName: 'sam@example.com' }),
    }));
  });

  it('maps accounting preflight blocks to 409', async () => {
    mocks.execute.mockRejectedValue(new CreditNoteReversalConflict('The linked Xero credit note has allocations.'));
    const response = await POST(request({ operationKey: 'key', reason: 'Mistake' }), params);
    expect(response.status).toBe(409);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('requires inputs and blocks Advisors', async () => {
    expect((await POST(request({ operationKey: 'key' }), params)).status).toBe(400);
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    expect((await POST(request({ operationKey: 'key', reason: 'Mistake' }), params)).status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});