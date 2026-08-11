import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { getOrderAmendmentHistory } from '../orderAmendmentHistory';

describe('getOrderAmendmentHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads completed tenant-scoped operations and normalizes header JSON', async () => {
    mockImsQuery.mockResolvedValueOnce([{
      id: 9,
      order_status: 'confirmed',
      actor_name: 'Alex',
      before_header_json: JSON.stringify({ status: 'confirmed', notes: 'Old', updated_at: 'old' }),
      after_header_json: JSON.stringify({ status: 'cancelled', notes: 'New', updated_at: 'new' }),
      line_change_count: '2',
      created_at: new Date('2026-08-11T10:00:00.000Z'),
      completed_at: new Date('2026-08-11T10:00:01.000Z'),
    }]).mockResolvedValueOnce([{
      id: 12,
      amendment_id: 9,
      source_line_id: 4,
      result_line_id: 4,
      before_line_json: JSON.stringify({ variant_id: 'red', qty_ordered: 5 }),
      after_line_json: JSON.stringify({ variant_id: 'red', qty_ordered: 3 }),
    }, {
      id: 13,
      amendment_id: 9,
      source_line_id: null,
      result_line_id: 8,
      before_line_json: null,
      after_line_json: JSON.stringify({ variant_id: 'blue', qty_ordered: 2 }),
    }]);

    await expect(getOrderAmendmentHistory('biz-1', 'purchase_order', 42)).resolves.toEqual([{
      id: 9,
      previousStatus: 'confirmed',
      resultingStatus: 'cancelled',
      actorName: 'Alex',
      lineChangeCount: 2,
      changedFields: ['notes'],
      lines: [{
        id: 12,
        changeType: 'updated',
        variantId: 'red',
        previousQuantity: 5,
        resultingQuantity: 3,
      }, {
        id: 13,
        changeType: 'added',
        variantId: 'blue',
        previousQuantity: null,
        resultingQuantity: 2,
      }],
      createdAt: '2026-08-11T10:00:00.000Z',
      completedAt: '2026-08-11T10:00:01.000Z',
    }]);
    expect(mockImsQuery).toHaveBeenCalledWith(
      expect.stringContaining("operation.state = 'complete'"),
      ['biz-1', 'purchase_order', 42],
    );
    expect(mockImsQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM ims_order_amendment_lines'),
      ['biz-1', 9],
    );
  });
});