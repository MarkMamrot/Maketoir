import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), imsQuery: vi.fn(), imsExecute: vi.fn(), xeroFetch: vi.fn(), runtimeIssue: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ query: mocks.query, execute: mocks.execute }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/services/XeroService', () => ({ getValidAccessToken: vi.fn(), xeroApiFetch: mocks.xeroFetch }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.runtimeIssue }));
vi.mock('@/lib/xero/accountingActionRepository', () => ({
  claimXeroAccountingAction: vi.fn(), completeXeroAccountingAction: vi.fn(), failXeroAccountingAction: vi.fn(),
}));

import { syncStocktakeJournal, syncStocktakeReversalJournal } from '../XeroSyncService';

const itemSnapshot = {
  variant_id: 'v-1', sku: 'SKU-1', product_name: 'Widget', expected_qty: '10', counted_qty: '6',
  applied_delta: '-2', unit_cost_at_apply: '5.5',
};

describe('stocktake Xero journals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation((sql: string) => Promise.resolve(
      sql.includes('xero_account_mappings')
        ? [{ role_key: 'inventory_asset', xero_account_code: '630' }, { role_key: 'stock_adjustment', xero_account_code: '400' }]
        : [],
    ));
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.imsExecute.mockResolvedValue({ affectedRows: 1 });
  });

  it('values the original journal from applied delta and captured cost, not count-start variance', async () => {
    mocks.imsQuery.mockImplementation((sql: string) => Promise.resolve(
      sql.includes('FROM ims_stocktakes WHERE')
        ? [{ id: 31, reference: 'ST-31', location_id: 4, completed_at: '2026-08-12', status: 'completed' }]
        : [itemSnapshot],
    ));
    mocks.xeroFetch.mockResolvedValue({ ManualJournals: [{ ManualJournalID: 'journal-1', Status: 'POSTED' }] });

    const result = await syncStocktakeJournal('biz-1', 31);

    expect(result).toEqual({ journalId: 'journal-1', lines: 1, totalValue: 11 });
    const options = mocks.xeroFetch.mock.calls[0][2];
    expect(options.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(options.body.ManualJournals[0].JournalLines).toEqual([
      expect.objectContaining({ LineAmount: 11, AccountCode: '400' }),
      expect.objectContaining({ LineAmount: -11, AccountCode: '630' }),
    ]);
  });

  it('posts the exact opposite linked journal for a confirmed original', async () => {
    mocks.imsQuery.mockImplementation((sql: string) => Promise.resolve(
      sql.includes('xero_reversal_journal_id')
        ? [{
            id: 31, reference: 'ST-31', location_id: 4, reverted_at: '2026-08-13', status: 'reverted',
            xero_journal_id: 'journal-1', xero_sync_status: 'synced', xero_reversal_journal_id: null,
          }]
        : [itemSnapshot],
    ));
    mocks.xeroFetch.mockResolvedValue({ ManualJournals: [{ ManualJournalID: 'journal-reversal-1', Status: 'POSTED' }] });

    const result = await syncStocktakeReversalJournal('biz-1', 31);

    expect(result).toEqual({ journalId: 'journal-reversal-1', lines: 1, totalValue: 11 });
    const options = mocks.xeroFetch.mock.calls[0][2];
    expect(options.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(options.body.ManualJournals[0].Narration).toContain('journal-1');
    expect(options.body.ManualJournals[0].JournalLines).toEqual([
      expect.objectContaining({ LineAmount: 11, AccountCode: '630' }),
      expect.objectContaining({ LineAmount: -11, AccountCode: '400' }),
    ]);
    expect(mocks.imsExecute).toHaveBeenCalledWith(
      expect.stringContaining('xero_reversal_journal_id'),
      ['synced', null, 'journal-reversal-1', 31, 'biz-1'],
    );
  });

  it('blocks a reversing journal when the original posting is not confirmed', async () => {
    mocks.imsQuery.mockResolvedValue([{
      id: 31, reference: 'ST-31', location_id: 4, reverted_at: '2026-08-13', status: 'reverted',
      xero_journal_id: null, xero_sync_status: 'error', xero_reversal_journal_id: null,
    }]);

    await expect(syncStocktakeReversalJournal('biz-1', 31)).rejects.toThrow('not confirmed');

    expect(mocks.xeroFetch).not.toHaveBeenCalled();
    expect(mocks.imsExecute).toHaveBeenCalledWith(
      expect.stringContaining('xero_reversal_sync_status'),
      ['blocked', 'Original journal posting is not confirmed.', 31, 'biz-1'],
    );
  });
});
