import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  execute: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/creditNoteStatusCommands', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ims/creditNoteStatusCommands')>();
  return { ...actual, executeCreditNoteStatusCommand: mocks.execute };
});
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsCNRepo: { get: mocks.get } }));

import { POST } from '../route';
import { InventoryDocumentRevisionConflict } from '@/lib/ims/creditNoteStatusCommands';

const params = { params: { id: '17' } };
function request(body: unknown) {
  return new Request('http://localhost/api/ims/credit-notes/17/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ims/credit-notes/[id]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin', userId: 7, name: 'Alex' });
    mocks.execute.mockResolvedValue({ id: 17, status: 'cancelled', updatedAt: '2026-08-12T10:00:00.000Z', replayed: false });
    mocks.get.mockResolvedValue({ id: 17, status: 'cancelled', cn_number: 'CN-00017' });
  });

  it('requires a caller-stable operation key', async () => {
    const response = await POST(request({ expectedUpdatedAt: '2026-08-12T09:00:00.000Z' }), params);
    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('passes tenant, revision, and actor context to the command service', async () => {
    const response = await POST(request({
      operationKey: 'customer_credit_note:17:cancel:revision:r1:request:abc',
      expectedUpdatedAt: '2026-08-12T09:00:00.000Z',
    }), params);

    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      documentKind: 'customer_credit_note',
      documentId: 17,
      action: 'cancel',
      context: expect.objectContaining({
        operationKey: 'customer_credit_note:17:cancel:revision:r1:request:abc',
        expectedUpdatedAt: '2026-08-12T09:00:00.000Z',
        actorId: 7,
        actorName: 'Alex',
      }),
    }));
    expect(await response.json()).toMatchObject({ success: true, data: { status: 'cancelled' } });
  });

  it('maps stale revisions to a structured conflict', async () => {
    mocks.execute.mockRejectedValue(new InventoryDocumentRevisionConflict());
    const response = await POST(request({ operationKey: 'key', expectedUpdatedAt: 'old' }), params);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'inventory_document_revision_conflict' });
  });

  it('keeps Advisor accounts read-only', async () => {
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    const response = await POST(request({ operationKey: 'key' }), params);

    expect(response.status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});