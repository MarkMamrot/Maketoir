import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { AMAZON_PII_SOURCES } from '@/lib/securityCompliance/amazonPiiInventory';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), inventory: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/securityCompliance/amazonPiiInventoryRepository', () => ({ getAmazonPiiInventory: mocks.inventory }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { GET } from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockReturnValue({ user: { businessId: 'tenant-a', userId: 42 } });
  mocks.inventory.mockResolvedValue({ sources: AMAZON_PII_SOURCES.map(source => ({ id: source.id, availability: 'available', records: 0 })),
    deliveryEvidence: { availability: 'available' } });
  mocks.report.mockResolvedValue(null);
});

describe('SuperAdmin Amazon PII dry-run endpoint', () => {
  it('uses only the authenticated active business and disables caching', async () => {
    const response = await GET(new Request('http://localhost/api/admin/security-compliance/amazon-pii-inventory?after=123'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.inventory).toHaveBeenCalledWith({ businessId: 'tenant-a', afterId: 123 });
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it.each([401, 403])('denies access before tenant resolution (%s)', async status => {
    mocks.auth.mockReturnValue({ response: NextResponse.json({ error: 'Not authorized' }, { status }) });
    expect((await GET(new Request('http://localhost/api/admin/security-compliance/amazon-pii-inventory'))).status).toBe(status);
    expect(mocks.inventory).not.toHaveBeenCalled();
  });

  it.each(['businessId=tenant-b', 'after=-1', 'after=1.2', 'after=', 'after=01', 'after=2147483648', 'after=1&after=2', 'delete=true'])
    ('rejects unsupported scope, mutation and cursor inputs (%s)', async query => {
      const response = await GET(new Request(`http://localhost/api/admin/security-compliance/amazon-pii-inventory?${query}`));
      expect(response.status).toBe(400);
      expect(mocks.inventory).not.toHaveBeenCalled();
      expect(mocks.report).not.toHaveBeenCalled();
    });

  it('records partial coverage warnings without including buyer data', async () => {
    mocks.inventory.mockResolvedValueOnce({ sources: [{ id: 'linked-contact', availability: 'unavailable', records: null }],
      deliveryEvidence: { availability: 'available' } });
    expect((await GET(new Request('http://localhost/api/admin/security-compliance/amazon-pii-inventory'))).status).toBe(200);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'tenant-a', operation: 'check_coverage', context: { actorUserId: 42, unavailableSources: ['linked-contact'] },
    }));
  });

  it('reports operational failures explicitly rather than returning an empty inventory', async () => {
    mocks.inventory.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await GET(new Request('http://localhost/api/admin/security-compliance/amazon-pii-inventory'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: expect.stringContaining('could not be read') });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'tenant-a', operation: 'read_inventory', context: { actorUserId: 42, afterId: 0 },
    }));
  });
});
