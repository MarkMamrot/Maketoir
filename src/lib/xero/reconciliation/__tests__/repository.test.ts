import { describe, expect, it, vi } from 'vitest';

import { recordXeroReconciliationIssue } from '../repository';

describe('recordXeroReconciliationIssue', () => {
  it('upserts current state and appends an actor/reason event', async () => {
    const execute = vi.fn().mockResolvedValue({ affectedRows: 1 });
    const query = vi.fn()
      .mockResolvedValueOnce([{ id: 4 }])
      .mockResolvedValueOnce([{ id: 9 }]);

    const id = await recordXeroReconciliationIssue({
      businessId: 'biz-1', targetType: 'purchase_order', referenceId: 42, xeroId: 'bill-1',
      ruleKey: 'admin_edit_override', summary: 'Admin saved a local edit that Xero cannot accept.',
      expected: { localEdit: true }, actual: { xeroStatus: 'PAID' }, eventType: 'override',
      actorId: 7, actorName: 'Alex', reason: 'Supplier correction approved by bookkeeper',
    }, { execute: execute as any, query: query as any });

    expect(id).toBe(9);
    expect(String(execute.mock.calls[0][0])).toContain('xero_reconciliation_targets');
    expect(String(execute.mock.calls[1][0])).toContain('xero_reconciliation_issues');
    expect(execute.mock.calls[2][1]).toEqual(expect.arrayContaining([
      'biz-1', 9, 'override', '7', 'Alex', 'Supplier correction approved by bookkeeper',
    ]));
  });
});