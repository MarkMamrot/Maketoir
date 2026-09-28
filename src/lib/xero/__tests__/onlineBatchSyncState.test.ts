import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('@/services/MySQLService', () => ({ query: mockQuery }));

import { getCompletedOnlineBatchKeys, onlineBatchKey } from '../onlineBatchSyncState';

describe('online batch sync state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds an exact-instance batch key', () => {
    expect(onlineBatchKey({ channel_instance_id: 'store-1', day: '2026-09-18' }))
      .toBe('online batch store-1 2026-09-18');
  });

  it('recognises a legacy success only through the exact batch invoice link', async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ batch_key: 'online batch store-1 2026-09-18' }]);

    const completed = await getCompletedOnlineBatchKeys('biz-1', [
      { channel_instance_id: 'store-1', day: '2026-09-18' },
    ]);

    expect(completed.has('online batch store-1 2026-09-18')).toBe(true);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("BINARY legacy_log.detail = BINARY CONCAT('online batch ', DATE_FORMAT(batch.batch_date, '%Y-%m-%d'))");
    expect(sql).toContain('BINARY legacy_log.xero_id = BINARY batch.xero_invoice_id');
    expect(params).toEqual(['biz-1', 'online batch store-1 2026-09-18']);
  });

  it('does not query for an empty batch list', async () => {
    expect(await getCompletedOnlineBatchKeys('biz-1', [])).toEqual(new Set());
    expect(mockQuery).not.toHaveBeenCalled();
  });
});