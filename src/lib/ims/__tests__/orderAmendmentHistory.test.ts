import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { getOrderAmendmentHistory } from '../orderAmendmentHistory';

describe('getOrderAmendmentHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads completed tenant-scoped operations and normalizes header JSON', async () => {
    mockImsQuery.mockResolvedValue([{
      id: 9,
      order_status: 'confirmed',
      actor_name: 'Alex',
      after_header_json: JSON.stringify({ status: 'cancelled' }),
      line_change_count: '2',
      created_at: new Date('2026-08-11T10:00:00.000Z'),
      completed_at: new Date('2026-08-11T10:00:01.000Z'),
    }]);

    await expect(getOrderAmendmentHistory('biz-1', 'purchase_order', 42)).resolves.toEqual([{
      id: 9,
      previousStatus: 'confirmed',
      resultingStatus: 'cancelled',
      actorName: 'Alex',
      lineChangeCount: 2,
      createdAt: '2026-08-11T10:00:00.000Z',
      completedAt: '2026-08-11T10:00:01.000Z',
    }]);
    expect(mockImsQuery).toHaveBeenCalledWith(
      expect.stringContaining("operation.state = 'complete'"),
      ['biz-1', 'purchase_order', 42],
    );
  });
});