import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetImsSession,
  mockTriggerPOXeroSync,
  mockTriggerSOXeroSync,
  mockTriggerCNXeroSync,
  mockTriggerSupplierCNXeroSync,
  mockImsQuery,
  mockQuery,
} = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockTriggerPOXeroSync: vi.fn(),
  mockTriggerSOXeroSync: vi.fn(),
  mockTriggerCNXeroSync: vi.fn(),
  mockTriggerSupplierCNXeroSync: vi.fn(),
  mockImsQuery: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({
  getImsSession: mockGetImsSession,
}));

vi.mock('@/lib/ims/xeroHooks', () => ({
  triggerPOXeroSync: mockTriggerPOXeroSync,
  triggerSOXeroSync: mockTriggerSOXeroSync,
  triggerCNXeroSync: mockTriggerCNXeroSync,
  triggerSupplierCNXeroSync: mockTriggerSupplierCNXeroSync,
}));

vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mockImsQuery,
}));

vi.mock('@/services/MySQLService', () => ({
  query: mockQuery,
}));

import { POST } from '../route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/ims/xero/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ims/xero/push', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'biz-1' });
    mockTriggerPOXeroSync.mockResolvedValue(undefined);
    mockTriggerSOXeroSync.mockResolvedValue(undefined);
    mockTriggerCNXeroSync.mockResolvedValue(undefined);
    mockTriggerSupplierCNXeroSync.mockResolvedValue(undefined);
    mockImsQuery.mockResolvedValue([]);
    mockQuery.mockResolvedValue([]);
  });

  it('returns 401 when IMS session is missing', async () => {
    mockGetImsSession.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ type: 'cn', id: 11 }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated' });
  });

  it('returns 409 when CN retry lock is already held', async () => {
    mockQuery
      .mockResolvedValueOnce([{ acquired: 0 }])
      .mockResolvedValueOnce([{ released: 0 }]);

    const res = await POST(makeRequest({ type: 'cn', id: 11 }));

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('Retry already in progress');
    expect(mockTriggerCNXeroSync).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('RELEASE_LOCK'))).toBe(true);
  });

  it('skips CN retry when already synced with stored Xero id', async () => {
    mockQuery
      .mockResolvedValueOnce([{ acquired: 1 }])
      .mockResolvedValueOnce([{ released: 1 }]);
    mockImsQuery.mockResolvedValueOnce([
      { xero_sync_status: 'synced', xero_credit_note_id: 'xero-cn-1' },
    ]);

    const res = await POST(makeRequest({ type: 'cn', id: 12 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, skipped: true, reason: 'already_synced' });
    expect(mockTriggerCNXeroSync).not.toHaveBeenCalled();
  });

  it('triggers CN sync when lock acquired and note is not already synced', async () => {
    mockQuery
      .mockResolvedValueOnce([{ acquired: 1 }])
      .mockResolvedValueOnce([{ released: 1 }]);
    mockImsQuery.mockResolvedValueOnce([
      { xero_sync_status: 'queued', xero_credit_note_id: null },
    ]);

    const res = await POST(makeRequest({ type: 'cn', id: 13 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockTriggerCNXeroSync).toHaveBeenCalledWith('biz-1', 13);
  });

  it('applies the same lock/idempotency flow for SCN retries', async () => {
    mockQuery
      .mockResolvedValueOnce([{ acquired: 1 }])
      .mockResolvedValueOnce([{ released: 1 }]);
    mockImsQuery.mockResolvedValueOnce([
      { xero_sync_status: 'error', xero_credit_note_id: null },
    ]);

    const res = await POST(makeRequest({ type: 'scn', id: 21 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockTriggerSupplierCNXeroSync).toHaveBeenCalledWith('biz-1', 21);
  });
});
