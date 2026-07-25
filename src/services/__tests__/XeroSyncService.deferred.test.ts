import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockExecute, mockImsQuery, mockImsExecute, mockXeroApiFetch } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockExecute: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
  mockXeroApiFetch: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ query: mockQuery, execute: mockExecute }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery, imsExecute: mockImsExecute }));
vi.mock('@/services/XeroService', () => ({
  getValidAccessToken: vi.fn(),
  xeroApiFetch: mockXeroApiFetch,
}));

import {
  syncGiftCardRedemptionReclass,
  syncStoreCreditIssueReclass,
} from '../XeroSyncService';

function setupBaseMocks() {
  mockExecute.mockResolvedValue({ affectedRows: 1 });
  mockImsQuery.mockResolvedValue([]);
  mockImsExecute.mockResolvedValue({ affectedRows: 1 });
}

describe('Deferred liability lifecycle sync helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseMocks();
  });

  it('posts gift card redemption as DR liability / CR sales revenue journal', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM xero_sync_log') && sql.includes('sync_type = ?')) return Promise.resolve([]);
      if (sql.includes('FROM xero_account_mappings')) {
        return Promise.resolve([
          { role_key: 'sales_revenue', xero_account_code: '200' },
          { role_key: 'gift_card_liability', xero_account_code: '230' },
        ]);
      }
      if (sql.includes('FROM xero_tracking_mappings')) return Promise.resolve([]);
      if (sql.includes("SHOW COLUMNS FROM xero_sync_log LIKE 'xero_state'")) return Promise.resolve([{ Field: 'xero_state' }]);
      return Promise.resolve([]);
    });
    mockXeroApiFetch.mockResolvedValueOnce({
      ManualJournals: [{ ManualJournalID: 'mj-1', Status: 'POSTED' }],
    });

    const result = await syncGiftCardRedemptionReclass({
      businessId: 'biz-1',
      amount: 125.5,
      date: '2026-07-25',
      channel: 'pos',
      locationId: 4,
      dedupeKey: 'gift card redeem tx 99',
    });

    expect(result).toBe('mj-1');
    expect(mockXeroApiFetch).toHaveBeenCalledTimes(1);
    const [biz, endpoint, payload] = mockXeroApiFetch.mock.calls[0];
    expect(biz).toBe('biz-1');
    expect(endpoint).toBe('/ManualJournals');
    const lines = payload.body.ManualJournals[0].JournalLines;
    expect(lines[0]).toEqual(expect.objectContaining({
      AccountCode: '230',
      DebitAmount: 125.5,
      TaxType: 'NONE',
    }));
    expect(lines[1]).toEqual(expect.objectContaining({
      AccountCode: '200',
      CreditAmount: 125.5,
      TaxType: 'NONE',
    }));
  });

  it('skips store credit issue when liability mapping is missing and logs skipped event', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM xero_sync_log') && sql.includes('sync_type = ?')) return Promise.resolve([]);
      if (sql.includes('FROM xero_account_mappings')) {
        return Promise.resolve([{ role_key: 'sales_revenue', xero_account_code: '200' }]);
      }
      if (sql.includes("SHOW COLUMNS FROM xero_sync_log LIKE 'xero_state'")) return Promise.resolve([{ Field: 'xero_state' }]);
      return Promise.resolve([]);
    });

    const result = await syncStoreCreditIssueReclass({
      businessId: 'biz-1',
      amount: 75,
      date: '2026-07-25',
      channel: 'pos',
      dedupeKey: 'store credit issue tx 11',
    });

    expect(result).toBeNull();
    expect(mockXeroApiFetch).not.toHaveBeenCalled();
    const insertLogCall = mockExecute.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO xero_sync_log') &&
      Array.isArray(call[1]) &&
      call[1][1] === 'store_credit_issue',
    );
    expect(insertLogCall).toBeTruthy();
    expect(insertLogCall?.[1]?.[4]).toBe('skipped');
  });

  it('returns null without posting when successful dedupe key already exists', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM xero_sync_log') && sql.includes('sync_type = ?')) return Promise.resolve([{ id: 1 }]);
      return Promise.resolve([]);
    });

    const result = await syncGiftCardRedemptionReclass({
      businessId: 'biz-1',
      amount: 44,
      date: '2026-07-25',
      channel: 'pos',
      dedupeKey: 'gift card redeem tx 1',
    });

    expect(result).toBeNull();
    expect(mockXeroApiFetch).not.toHaveBeenCalled();
  });
});
