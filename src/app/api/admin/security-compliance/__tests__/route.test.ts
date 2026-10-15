import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createDefaultPolicyAssignments } from '@/lib/securityCompliance/policies';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn(), save: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/securityCompliance/repository', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/securityCompliance/repository')>();
  return { ...actual, getPolicyAssignments: mocks.get, savePolicyAssignments: mocks.save };
});
import { PolicyAssignmentConflictError } from '@/lib/securityCompliance/repository';
import { GET, PUT } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/admin/security-compliance', { method: 'PUT', body: JSON.stringify(body) });
}

describe('SuperAdmin security policies API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockReturnValue({ user: { userId: 42, tier: 'SuperAdmin', businessId: 'business-a' } });
    mocks.get.mockResolvedValue({ assignments: createDefaultPolicyAssignments(), revision: 0, updatedAt: null, updatedBy: null });
    mocks.save.mockResolvedValue({ assignments: createDefaultPolicyAssignments(), revision: 1, updatedAt: null, updatedBy: 42 });
    mocks.report.mockResolvedValue(null);
  });

  it('returns fresh platform assignments', async () => {
    const response = await GET();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ success: true, state: { revision: 0 } });
  });

  it('uses the verified actor rather than a submitted actor or business', async () => {
    const assignments = createDefaultPolicyAssignments();
    const response = await PUT(request({ assignments, expectedRevision: 0, actorUserId: 999, businessId: 'other' }));
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith({ assignments, expectedRevision: 0, actorUserId: 42 });
  });

  it.each([401, 403])('denies non-SuperAdmins before reads or writes (%s)', async status => {
    mocks.auth.mockReturnValue({ response: NextResponse.json({ error: 'Not authorized' }, { status }) });
    expect((await GET()).status).toBe(status);
    expect((await PUT(request({ assignments: createDefaultPolicyAssignments(), expectedRevision: 0 }))).status).toBe(status);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { assignments: {}, expectedRevision: 0 },
    { assignments: createDefaultPolicyAssignments(), expectedRevision: -1 },
    { assignments: createDefaultPolicyAssignments(), expectedRevision: '0' }])('rejects invalid requests without writes', async body => {
    expect((await PUT(request(body))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON as validation rather than an operational issue', async () => {
    const response = await PUT(new Request('http://localhost/api/admin/security-compliance', { method: 'PUT', body: '{' }));
    expect(response.status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('reports a stale save without treating it as a runtime failure', async () => {
    mocks.save.mockRejectedValueOnce(new PolicyAssignmentConflictError());
    expect((await PUT(request({ assignments: createDefaultPolicyAssignments(), expectedRevision: 0 }))).status).toBe(409);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it.each(['load', 'save'])('records operational %s failures with safe context', async operation => {
    if (operation === 'load') mocks.get.mockRejectedValueOnce(new Error('database unavailable'));
    else mocks.save.mockRejectedValueOnce(new Error('database unavailable'));
    const response = operation === 'load' ? await GET()
      : await PUT(request({ assignments: createDefaultPolicyAssignments(), expectedRevision: 0 }));
    expect(response.status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-a', source: 'admin.security-compliance', context: expect.objectContaining({ actorUserId: 42 }),
    }));
  });
});
