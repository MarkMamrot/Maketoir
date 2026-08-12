import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), execute: vi.fn(), get: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/creditNotes/creditNoteReversalWorkflow', () => ({ executeCreditNoteReversalWorkflow: mocks.execute }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsCNRepo: { get: mocks.get } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';
import { CreditNoteReversalConflict } from '@/lib/ims/creditNotes/creditNoteCorrections';

const params = { params: { id: '17' } };
function request(body: unknown) {
  return new Request('http://localhost/api/ims/credit-notes/17/reverse', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/ims/credit-notes/[id]/reverse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin', userId: 7, name: 'Alex' });
    mocks.execute.mockResolvedValue({ id: 17, status: 'reversed', replayed: false, xeroCorrectionStatus: 'queued', xeroWarning: null });
    mocks.get.mockResolvedValue({ id: 17, status: 'reversed' });
  });

  it('requires an operation key and reason', async () => {
    expect((await POST(request({ reason: 'Mistake' }), params)).status).toBe(400);
    expect((await POST(request({ operationKey: 'key' }), params)).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('passes normalized reason, tenant, revision, and actor context', async () => {
    const response = await POST(request({ operationKey: 'stable-key', expectedUpdatedAt: 'revision', reason: '  Entered twice  ' }), params);

    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'customer_credit_note', businessId: 'biz-1', documentId: 17, reason: 'Entered twice',
      context: expect.objectContaining({ operationKey: 'stable-key', expectedUpdatedAt: 'revision', actorId: 7, actorName: 'Alex' }),
    }));
  });

  it('maps guarded reversal blocks to 409 without reporting an operational issue', async () => {
    mocks.execute.mockRejectedValue(new CreditNoteReversalConflict('Store credit was spent.'));
    const response = await POST(request({ operationKey: 'key', reason: 'Mistake' }), params);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'credit_note_reversal_conflict' });
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('keeps Advisor accounts read-only', async () => {
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    expect((await POST(request({ operationKey: 'key', reason: 'Mistake' }), params)).status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});