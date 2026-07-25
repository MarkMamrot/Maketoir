import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const {
  mockRequireAdminSession,
  mockAssertBusinessAccess,
  mockCalculateCogsForPeriod,
} = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockCalculateCogsForPeriod: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  assertBusinessAccess: mockAssertBusinessAccess,
}));

vi.mock('@/lib/xero/cogsCalculator', () => ({
  calculateCogsForPeriod: mockCalculateCogsForPeriod,
}));

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
  });

  it('previews the last completed period without posting', async () => {
    const response = await POST(makeRequest({ databaseId: 'biz-1', frequency: 'monthly' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.period.frequency).toBe('monthly');
    expect(json.calculation.totalCOGS).toBe(125);
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