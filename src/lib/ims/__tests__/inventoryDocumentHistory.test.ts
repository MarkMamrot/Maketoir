import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { getInventoryDocumentActivityHistory } from '../inventoryDocumentHistory';

describe('getInventoryDocumentActivityHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns newest safe lifecycle summaries without raw ledger metadata', async () => {
    mockImsQuery.mockResolvedValue([{
      id: 91,
      action: 'revert_mistaken_completion',
      previous_status: 'complete',
      resulting_status: 'reversed',
      actor_name: 'Alex',
      after_metadata_json: JSON.stringify({
        reason: 'Entered twice',
        stockMovementCount: 2,
        storeCreditReversed: 25,
        secretPayload: { customer: 'must not escape' },
      }),
      created_at: new Date('2026-08-12T09:00:00.000Z'),
      completed_at: new Date('2026-08-12T09:01:00.000Z'),
    }]);

    const history = await getInventoryDocumentActivityHistory('biz-1', 'customer_credit_note', 12);

    expect(mockImsQuery).toHaveBeenCalledWith(expect.stringContaining('LIMIT 25'), ['biz-1', 'customer_credit_note', 12]);
    expect(history).toEqual([expect.objectContaining({
      id: 91,
      title: 'Mistaken completion reversed',
      previousStatus: 'complete',
      resultingStatus: 'reversed',
      actorName: 'Alex',
      details: ['Reason: Entered twice', '2 stock movements compensated', 'Store credit reversed: $25.00'],
    })]);
    expect(JSON.stringify(history)).not.toContain('secretPayload');
    expect(JSON.stringify(history)).not.toContain('must not escape');
  });
});
