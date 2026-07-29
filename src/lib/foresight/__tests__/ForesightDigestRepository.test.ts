import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecute, mockQuery } = vi.hoisted(() => ({ mockExecute: vi.fn(), mockQuery: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ execute: mockExecute, query: mockQuery }));

import { ForesightDigestRepository } from '../repositories/ForesightDigestRepository';

const snapshot = {
  version: 1 as const, digestDate: '2026-07-29',
  counts: { total: 0, high: 0, pendingApproval: 0, implementationOverdue: 0, expiringSoon: 0, outcomeAvailable: 0, dataQualityBlocked: 0 },
  items: [],
};

describe('ForesightDigestRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts one refreshable digest per tenant and local date', async () => {
    mockExecute.mockResolvedValue({ insertId: 12 });
    await expect(ForesightDigestRepository.upsertDaily('business-1', '2026-07-29', snapshot)).resolves.toBe(12);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringMatching(/ON DUPLICATE KEY UPDATE[\s\S]*snapshot_json = VALUES/),
      ['business-1', '2026-07-29', JSON.stringify(snapshot)],
    );
  });

  it('lists only tenant-scoped daily digests and parses snapshots', async () => {
    mockQuery.mockResolvedValue([{ business_id: 'business-1', snapshot_json: JSON.stringify(snapshot) }]);
    const rows = await ForesightDigestRepository.listRecent('business-1', 100);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('LIMIT 31'), ['business-1', 'daily_operations']);
    expect(rows[0].snapshot_json).toEqual(snapshot);
  });

  it('upserts weekly summaries independently from daily operations', async () => {
    mockExecute.mockResolvedValue({ insertId: 13 });
    const weekly = { version: 1, digestType: 'weekly_summary', digestDate: '2026-07-28' } as any;
    await expect(ForesightDigestRepository.upsertWeekly('business-1', '2026-07-28', weekly)).resolves.toBe(13);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, 'weekly_summary', ?, ?)"),
      ['business-1', '2026-07-28', JSON.stringify(weekly)],
    );
  });
});