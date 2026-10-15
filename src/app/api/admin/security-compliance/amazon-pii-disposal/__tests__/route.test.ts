import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { AmazonPiiConflictError } from '@/lib/securityCompliance/amazonPiiDisposal';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), preview: vi.fn(), approve: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/securityCompliance/amazonPiiDisposalRepository', () => ({
  getAmazonPiiDisposalPreview: mocks.preview, approveAmazonPiiDisposal: mocks.approve,
}));
import { GET, POST } from '../route';
const url = 'http://localhost/api/admin/security-compliance/amazon-pii-disposal';
const body = () => ({ expectedBusinessId: 'tenant-a', salesOrderId: 42, token: 'a'.repeat(64),
  expiresAt: '2026-10-15T00:15:00.000Z', operationKey: '12345678-1234-4234-9234-123456789abc', confirmation: 'CLEAR AMAZON PII 42' });
const post = (value: unknown) => POST(new Request(url, { method: 'POST', body: JSON.stringify(value) }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockReturnValue({ user: { businessId: 'tenant-a', userId: 99 } });
  mocks.preview.mockResolvedValue({ salesOrderId: 42 });
  mocks.approve.mockResolvedValue({ salesOrderId: 42, structuredFieldsCleared: true, copyReviewRequired: true });
});
describe('privileged Amazon cleanup API', () => {
  it('uses the authenticated tenant and actor, returns no-store, and keeps previews read-only', async () => {
    expect((await GET(new Request(`${url}?salesOrderId=42`))).status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith({ businessId: 'tenant-a', actorUserId: 99, salesOrderId: 42 });
    expect(mocks.approve).not.toHaveBeenCalled();
    const response = await post(body());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.approve).toHaveBeenCalledWith({ businessId: 'tenant-a', actorUserId: 99, request: body() });
  });
  it.each([401, 403])('refuses unauthorized reads and cleanup before tenant work (%s)', async status => {
    mocks.auth.mockReturnValue({ response: NextResponse.json({ error: 'Denied' }, { status }) });
    expect((await GET(new Request(`${url}?salesOrderId=42`))).status).toBe(status);
    expect((await post(body())).status).toBe(status);
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.approve).not.toHaveBeenCalled();
  });
  it.each(['actorUserId', 'businessId', 'rawPayload'])('rejects overrides and raw buyer payloads (%s)', async field => {
    expect((await post({ ...body(), [field]: 'unapproved' })).status).toBe(400);
    expect(mocks.approve).not.toHaveBeenCalled();
  });
  it('treats stale approvals as conflicts and reports operational failures without echoing them to clients', async () => {
    mocks.approve.mockRejectedValueOnce(new AmazonPiiConflictError('Reload preview.'));
    expect((await post(body())).status).toBe(409);
    expect(mocks.report).not.toHaveBeenCalled();
    mocks.preview.mockRejectedValueOnce(new Error('Storage unavailable'));
    expect((await GET(new Request(`${url}?salesOrderId=42`))).status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'tenant-a', operation: 'preview', context: { actorUserId: 99 } }));
  });
});
