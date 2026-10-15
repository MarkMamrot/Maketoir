import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { PolicyEvidenceValidationError } from '@/lib/securityCompliance/policyEvidence';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), state: vi.fn(), logs: vi.fn(), save: vi.fn(), report: vi.fn(),
  Conflict: class extends Error {},
}));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/securityCompliance/repository', () => ({
  getPolicyEvidence: mocks.state, getAuthenticationReviewData: mocks.logs, savePolicyEvidence: mocks.save,
  PolicyEvidenceConflictError: mocks.Conflict,
}));
import { GET, POST } from '../route';

const body = () => ({
  policyId: 'incident-response', kind: 'adoption', expectedRevision: 3, policyHash: 'a'.repeat(64),
  operationKey: 'c042862d-870e-45c5-a293-57f2ed3f6ef0', summary: 'Policy authorised',
  evidenceReference: 'Restricted review register', reviewFrom: null, reviewThrough: null, acknowledged: true,
});
const request = (value: unknown = body()) => new Request('http://localhost/api/admin/security-compliance/evidence', {
  method: 'POST', body: JSON.stringify(value),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockReturnValue({ user: { userId: 42, tier: 'SuperAdmin', businessId: 'business-a' } });
  mocks.state.mockResolvedValue({ policies: [], history: [] });
  mocks.logs.mockResolvedValue({ totalCount: 0, hasMore: false, entries: [] });
  mocks.save.mockResolvedValue({ id: 7 });
});

describe('security evidence authorization and attribution', () => {
  it.each([401, 403])('blocks unauthorized reads and writes before repository access (%s)', async status => {
    mocks.auth.mockReturnValue({ response: NextResponse.json({ error: 'Not authorized' }, { status }) });
    expect((await GET(new Request('http://localhost/api/admin/security-compliance/evidence'))).status).toBe(status);
    expect((await POST(request())).status).toBe(status);
    expect(mocks.state).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it('returns uncached evidence without recording an adoption', async () => {
    const response = await GET(new Request('http://localhost/api/admin/security-compliance/evidence'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('passes the requested log range and cursor to the platform-wide reader', async () => {
    const response = await GET(new Request('http://localhost/api/admin/security-compliance/evidence?authentication=1&from=2026-10-01&through=2026-10-15&beforeId=99'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.logs).toHaveBeenCalledWith({ from: '2026-10-01', through: '2026-10-15', beforeId: 99 });
    expect(mocks.state).not.toHaveBeenCalled();
  });

  it('records only the verified signed-in actor', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith({ request: body(), actorUserId: 42 });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each([null, {}, { ...body(), actorUserId: 999 }, { ...body(), businessId: 'other' }, { ...body(), acknowledged: false }])(
    'rejects malformed or spoofed submissions as validation', async value => {
      expect((await POST(request(value))).status).toBe(400);
      expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid JSON without treating it as an operational incident', async () => {
    expect((await POST(new Request('http://localhost/api/admin/security-compliance/evidence', { method: 'POST', body: '{' }))).status).toBe(400);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('returns a validation result for a bad log period', async () => {
    mocks.logs.mockRejectedValueOnce(new PolicyEvidenceValidationError('Invalid review period'));
    expect((await GET(new Request('http://localhost/api/admin/security-compliance/evidence?authentication=1'))).status).toBe(400);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('returns revision/hash conflicts without an operational incident', async () => {
    mocks.save.mockRejectedValueOnce(new mocks.Conflict('Reload the policy'));
    expect((await POST(request())).status).toBe(409);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it.each(['read', 'save'])('reports unexpected %s failure with safe actor context', async kind => {
    if (kind === 'read') mocks.state.mockRejectedValueOnce(new Error('storage unavailable'));
    else mocks.save.mockRejectedValueOnce(new Error('storage unavailable'));
    const response = kind === 'read' ? await GET(new Request('http://localhost/api/admin/security-compliance/evidence')) : await POST(request());
    expect(response.status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-a', source: 'admin.security-compliance', context: expect.objectContaining({ actorUserId: 42 }),
    }));
  });
});
