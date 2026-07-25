import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetImsSession,
  mockTriggerPOXeroSync,
  mockTriggerSOXeroSync,
  mockTriggerCNXeroSync,
  mockTriggerSupplierCNXeroSync,
  mockSyncGiftCardIssueInvoice,
  mockSyncGiftCardRedemptionReclass,
  mockSyncStoreCreditIssueReclass,
  mockSyncStoreCreditRedemptionReclass,
  mockImsQuery,
  mockQuery,
} = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockTriggerPOXeroSync: vi.fn(),
  mockTriggerSOXeroSync: vi.fn(),
  mockTriggerCNXeroSync: vi.fn(),
  mockTriggerSupplierCNXeroSync: vi.fn(),
  mockSyncGiftCardIssueInvoice: vi.fn(),
  mockSyncGiftCardRedemptionReclass: vi.fn(),
  mockSyncStoreCreditIssueReclass: vi.fn(),
  mockSyncStoreCreditRedemptionReclass: vi.fn(),
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

vi.mock('@/services/XeroSyncService', () => ({
  syncGiftCardIssueInvoice: mockSyncGiftCardIssueInvoice,
  syncGiftCardRedemptionReclass: mockSyncGiftCardRedemptionReclass,
  syncStoreCreditIssueReclass: mockSyncStoreCreditIssueReclass,
  syncStoreCreditRedemptionReclass: mockSyncStoreCreditRedemptionReclass,
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
    mockSyncGiftCardIssueInvoice.mockResolvedValue('xero-gci-1');
    mockSyncGiftCardRedemptionReclass.mockResolvedValue('xero-gcr-1');
    mockSyncStoreCreditIssueReclass.mockResolvedValue('xero-sci-1');
    mockSyncStoreCreditRedemptionReclass.mockResolvedValue('xero-scr-1');
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

  it('replays gift card redemption retry by transaction id', async () => {
    mockImsQuery.mockResolvedValueOnce([
      { id: 17, amount: '22.50', tx_date: '2026-07-25', location_id: 4 },
    ]);

    const res = await POST(makeRequest({ type: 'gift_card_redeem', id: 17 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockSyncGiftCardRedemptionReclass).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      amount: 22.5,
      date: '2026-07-25',
      channel: 'pos',
      locationId: 4,
      dedupeKey: 'gift card redeem tx 17',
      referenceId: 17,
    }));
  });

  it('replays store credit issue retry by transaction id', async () => {
    mockImsQuery.mockResolvedValueOnce([
      { id: 31, type: 'issue', amount: '15.00', tx_date: '2026-07-24', location_id: 2 },
    ]);

    const res = await POST(makeRequest({ type: 'store_credit_issue', id: 31 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockSyncStoreCreditIssueReclass).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      amount: 15,
      date: '2026-07-24',
      channel: 'pos',
      locationId: 2,
      dedupeKey: 'store credit issue tx 31',
      referenceId: 31,
    }));
  });
});
