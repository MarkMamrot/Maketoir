import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminTier, mockRollback } = vi.hoisted(() => ({ mockRequireAdminTier: vi.fn(), mockRollback: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mockRequireAdminTier }));
vi.mock('@/lib/foresight/ForesightMetaRollbackService', () => ({ ForesightMetaRollbackService: { rollback: mockRollback } }));
import { POST } from '../route';

const fingerprint = 'c'.repeat(64);
const request = (body: Record<string, unknown>) => new Request('http://localhost/meta/rollback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('POST Meta rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminTier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mockRollback.mockResolvedValue({ execution: { id: 20, state: 'succeeded' } });
  });

  it('requires the exact confirmation phrase', async () => {
    const response = await POST(request({ executionId: 19, proposalHash: 'proposal', confirmationFingerprint: fingerprint, confirmationPhrase: 'yes' }), { params: { id: '42' } });
    expect(response.status).toBe(400);
    expect(mockRollback).not.toHaveBeenCalled();
  });

  it('derives tenant and actor from the admin session', async () => {
    const response = await POST(request({ executionId: 19, proposalHash: 'proposal', confirmationFingerprint: fingerprint, confirmationPhrase: 'REVERSE META BUDGET CHANGES', businessId: 'attacker' }), { params: { id: '42' } });
    expect(response.status).toBe(200);
    expect(mockRollback).toHaveBeenCalledWith({ businessId: 'business-1', recommendationId: 42, originalExecutionId: 19, actorId: 7, proposalHash: 'proposal', confirmationFingerprint: fingerprint });
  });
});
