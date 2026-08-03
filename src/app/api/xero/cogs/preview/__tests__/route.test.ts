import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const {
  mockRequireAdminSession,
  mockAssertBusinessAccess,
  mockCalculateCogsForPeriod,
  mockRunImsForBusiness,
  mockGetBusinessTimeZone,
} = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockCalculateCogsForPeriod: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
  mockGetBusinessTimeZone: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  assertBusinessAccess: mockAssertBusinessAccess,
}));

vi.mock('@/lib/xero/cogsCalculator', () => ({
  calculateCogsForPeriod: mockCalculateCogsForPeriod,
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: mockGetBusinessTimeZone }));

import { POST } from '../route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/xero/cogs/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/xero/cogs/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { id: 'u1' }, response: null });
    mockAssertBusinessAccess.mockReturnValue(null);
    mockCalculateCogsForPeriod.mockResolvedValue({ totalCOGS: 125, blocked: false });
    mockGetBusinessTimeZone.mockResolvedValue('Australia/Sydney');
    mockRunImsForBusiness.mockImplementation(async (_businessId, callback) => callback());
  });

  it('previews the last completed period without posting', async () => {
    let tenantContextActive = false;
    mockRunImsForBusiness.mockImplementationOnce(async (_businessId, callback) => {
      tenantContextActive = true;
      try {
        return await callback();
      } finally {
        tenantContextActive = false;
      }
    });
    mockCalculateCogsForPeriod.mockImplementationOnce(async () => {
      expect(tenantContextActive).toBe(true);
      return { totalCOGS: 125, blocked: false };
    });

    const response = await POST(makeRequest({ databaseId: 'biz-1', frequency: 'monthly' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.period.frequency).toBe('monthly');
    expect(json.calculation.totalCOGS).toBe(125);
    expect(mockRunImsForBusiness).toHaveBeenCalledWith('biz-1', expect.any(Function));
    expect(mockCalculateCogsForPeriod).toHaveBeenCalledOnce();
  });

  it('rejects unsupported frequencies before querying IMS', async () => {
    const response = await POST(makeRequest({ databaseId: 'biz-1', frequency: 'fortnightly' }));
    expect(response.status).toBe(400);
    expect(mockCalculateCogsForPeriod).not.toHaveBeenCalled();
  });

  it('honours business access checks', async () => {
    mockAssertBusinessAccess.mockReturnValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const response = await POST(makeRequest({ databaseId: 'other-business' }));
    expect(response.status).toBe(403);
    expect(mockCalculateCogsForPeriod).not.toHaveBeenCalled();
  });
});