import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminSession, mockAssertBusinessAccess, mockSyncOnlineDailySalesDay } = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockSyncOnlineDailySalesDay: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  assertBusinessAccess: mockAssertBusinessAccess,
}));
vi.mock('@/lib/xero/onlineDailySalesSync', () => ({
  syncOnlineDailySalesDay: mockSyncOnlineDailySalesDay,
}));

import { POST } from '../route';

describe('POST /api/xero/sync/daily-sales', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'biz-1' }, response: null });
    mockAssertBusinessAccess.mockReturnValue(null);
  });

  it('rejects POS batches because POS revenue belongs to EOD reconciliation', async () => {
    const request = new Request('http://localhost/api/xero/sync/daily-sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ databaseId: 'biz-1', date: '2026-07-25', channel: 'pos' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('POS end-of-day reconciliation');
    expect(mockSyncOnlineDailySalesDay).not.toHaveBeenCalled();
  });
});