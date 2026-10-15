import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { DeliveryEvidenceConflictError } from '@/lib/securityCompliance/amazonDeliveryEvidence';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), save: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/securityCompliance/amazonDeliveryEvidenceRepository', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/securityCompliance/amazonDeliveryEvidenceRepository')>();
  return { DeliveryEvidenceNotFoundError: actual.DeliveryEvidenceNotFoundError, getAmazonDeliveryEvidence: mocks.read, saveManualDeliveryEvidence: mocks.save };
});
import { GET, POST } from '../route';

const url = 'http://localhost/api/admin/security-compliance/amazon-delivery-evidence';
const body = () => ({ action: 'record', salesOrderId: 42, parcelId: null, deliveredAt: '2025-09-01T10:00:00+10:00',
  basis: 'carrier-portal', reference: 'TICKET-123', verified: true, operationKey: '12345678-1234-4234-9234-123456789abc' });
const post = (value: unknown) => POST(new Request(url, { method: 'POST', body: JSON.stringify(value) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockReturnValue({ user: { businessId: 'tenant-a', userId: 99 } });
  mocks.read.mockResolvedValue({ salesOrderId: 42 }); mocks.save.mockResolvedValue(7); mocks.report.mockResolvedValue(null);
});

describe('SuperAdmin delivery verification API', () => {
  it('uses authenticated business and actor, not policy responsibility text', async () => {
    const response = await post(body());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.save).toHaveBeenCalledWith('tenant-a', 99, expect.objectContaining({ deliveredAt: '2025-09-01T00:00:00.000Z' }));
    expect(await response.json()).toEqual({ success: true, evidenceId: 7 });
  });
  it.each([401, 403])('blocks reads and writes before tenant work (%s)', async status => {
    mocks.auth.mockReturnValue({ response: NextResponse.json({ error: 'Denied' }, { status }) });
    expect((await GET(new Request(`${url}?salesOrderId=42`))).status).toBe(status);
    expect((await post(body())).status).toBe(status);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(['businessId', 'actorUserId', 'source', 'rawPayload'])('rejects overrides and buyer payloads (%s)', async key => {
    expect((await post({ ...body(), [key]: 'unapproved' })).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalled();
  });
  it.each(['salesOrderId=0', 'salesOrderId=42%0A', 'salesOrderId=1&salesOrderId=2', 'salesOrderId=42&businessId=b'])('rejects unsafe query input (%s)', async query => {
    expect((await GET(new Request(`${url}?${query}`))).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('reads only the active business and handles conflicts as validation, not incidents', async () => {
    expect((await GET(new Request(`${url}?salesOrderId=42`))).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith('tenant-a', 42);
    mocks.save.mockRejectedValueOnce(new DeliveryEvidenceConflictError('Already used'));
    expect((await post(body())).status).toBe(409);
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('records operational failures and never returns empty success', async () => {
    mocks.read.mockRejectedValueOnce(new Error('missing evidence storage'));
    const response = await GET(new Request(`${url}?salesOrderId=42`));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('unavailable') });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'tenant-a', operation: 'read_evidence', context: { actorUserId: 99 } }));
  });
});
