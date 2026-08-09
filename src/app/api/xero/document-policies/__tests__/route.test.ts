import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_XERO_DOCUMENT_POLICY } from '@/lib/xero/documentPolicies';

const {
  mockRequireAdminSession,
  mockAssertBusinessAccess,
  mockGetPolicy,
  mockSavePolicy,
  mockReportRuntimeIssue,
} = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockGetPolicy: vi.fn(),
  mockSavePolicy: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  assertBusinessAccess: mockAssertBusinessAccess,
}));
vi.mock('@/lib/xero/documentPolicyRepository', () => ({
  getXeroDocumentPolicy: mockGetPolicy,
  saveXeroDocumentPolicy: mockSavePolicy,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { GET, PUT } from '../route';

function putRequest(body: unknown): Request {
  return new Request('http://localhost/api/xero/document-policies', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/xero/document-policies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Admin', userId: 7, name: 'Alex' } });
    mockAssertBusinessAccess.mockReturnValue(null);
    mockGetPolicy.mockResolvedValue({ ...DEFAULT_XERO_DOCUMENT_POLICY });
    mockSavePolicy.mockResolvedValue({ before: DEFAULT_XERO_DOCUMENT_POLICY, changedFields: [] });
    mockReportRuntimeIssue.mockResolvedValue(null);
  });

  it('returns current-behaviour defaults when no policy has been saved', async () => {
    const response = await GET(new Request(
      'http://localhost/api/xero/document-policies?databaseId=biz-1',
    ));
    expect(response.status).toBe(200);
    expect((await response.json()).policy).toEqual(DEFAULT_XERO_DOCUMENT_POLICY);
    expect(mockGetPolicy).toHaveBeenCalledWith('biz-1');
  });

  it('persists a valid business policy', async () => {
    const policy = {
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      poCompletedAction: 'none',
      soPaymentSyncEnabled: false,
    };
    const response = await PUT(putRequest({ databaseId: 'biz-1', policy }));
    expect(response.status).toBe(200);
    expect(mockSavePolicy).toHaveBeenCalledWith({
      businessId: 'biz-1', policy, actorId: 7, actorName: 'Alex', presetSource: null,
    });
  });

  it('rejects a backwards document transition', async () => {
    const response = await PUT(putRequest({
      databaseId: 'biz-1',
      policy: {
        ...DEFAULT_XERO_DOCUMENT_POLICY,
        poApprovedAction: 'authorised',
        poCompletedAction: 'draft',
      },
    }));
    expect(response.status).toBe(400);
    expect(mockSavePolicy).not.toHaveBeenCalled();
  });

  it('allows online Draft with immediate payment sync and returns its consequence warning', async () => {
    const response = await PUT(putRequest({
      databaseId: 'biz-1',
      policy: { ...DEFAULT_XERO_DOCUMENT_POLICY, onlineBatchAction: 'draft' },
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).warnings).toContain('Online clearing payments will authorise the daily online invoice before applying payment.');
  });

  it('attributes only an exact known preset', async () => {
    const response = await PUT(putRequest({
      databaseId: 'biz-1', policy: DEFAULT_XERO_DOCUMENT_POLICY, presetSource: 'balanced_automation',
    }));
    expect(response.status).toBe(200);
    expect(mockSavePolicy).toHaveBeenCalledWith(expect.objectContaining({ presetSource: 'balanced_automation' }));

    const mismatch = await PUT(putRequest({
      databaseId: 'biz-1', policy: { ...DEFAULT_XERO_DOCUMENT_POLICY, poPaymentSyncEnabled: false }, presetSource: 'balanced_automation',
    }));
    expect(mismatch.status).toBe(400);
  });

  it('blocks Advisor policy mutations before persistence', async () => {
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Advisor', userId: 8, name: 'Advisor' } });
    const response = await PUT(putRequest({ databaseId: 'biz-1', policy: DEFAULT_XERO_DOCUMENT_POLICY }));
    expect(response.status).toBe(403);
    expect(mockSavePolicy).not.toHaveBeenCalled();
  });

  it('rejects cross-business access before reading policy data', async () => {
    mockAssertBusinessAccess.mockReturnValue(new Response(null, { status: 403 }));
    const response = await GET(new Request(
      'http://localhost/api/xero/document-policies?databaseId=biz-2',
    ));
    expect(response.status).toBe(403);
    expect(mockGetPolicy).not.toHaveBeenCalled();
  });

  it('reports operational persistence failures', async () => {
    mockSavePolicy.mockRejectedValue(new Error('database unavailable'));
    const response = await PUT(putRequest({
      databaseId: 'biz-1',
      policy: DEFAULT_XERO_DOCUMENT_POLICY,
    }));
    expect(response.status).toBe(500);
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      operation: 'save_policy',
    }));
  });
});