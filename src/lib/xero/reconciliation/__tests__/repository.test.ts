import { describe, expect, it, vi } from 'vitest';

import {
  ignoreXeroReconciliationIssue,
  recordXeroReconciliationIssue,
  resolveXeroReconciliationIssue,
} from '../repository';

describe('recordXeroReconciliationIssue', () => {
  it('upserts current state and appends an actor/reason event', async () => {
    const execute = vi.fn().mockResolvedValue({ affectedRows: 1 });
    const query = vi.fn()
      .mockResolvedValueOnce([{ id: 4 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 9 }]);

    const id = await recordXeroReconciliationIssue({
      businessId: 'biz-1', targetType: 'purchase_order', referenceId: 42, xeroId: 'bill-1',
      ruleKey: 'admin_edit_override', summary: 'Admin saved a local edit that Xero cannot accept.',
      expected: { localEdit: true }, actual: { xeroStatus: 'PAID' }, eventType: 'override',
      actorId: 7, actorName: 'Alex', reason: 'Supplier correction approved by bookkeeper',
    }, { execute: execute as any, query: query as any });

    expect(id).toBe(9);
    expect(String(execute.mock.calls[0][0])).toContain('xero_reconciliation_targets');
    expect(String(execute.mock.calls[0][0])).toContain('expected_snapshot = expected_snapshot');
    expect(String(execute.mock.calls[1][0])).toContain('xero_reconciliation_issues');
    expect(execute.mock.calls[2][1]).toEqual(expect.arrayContaining([
      'biz-1', 9, 'override', '7', 'Alex', 'Supplier correction approved by bookkeeper',
    ]));
  });

  it('keeps an unchanged ignored mismatch quiet and ignored', async () => {
    const execute = vi.fn().mockResolvedValue({ affectedRows: 1 });
    const query = vi.fn()
      .mockResolvedValueOnce([{ id: 4 }])
      .mockResolvedValueOnce([{ id: 9, status: 'ignored', mismatch_fingerprint: 'same', ignored_fingerprint: 'same' }])
      .mockResolvedValueOnce([{ id: 9 }]);

    await recordXeroReconciliationIssue({
      businessId: 'biz-1', targetType: 'sales_order', referenceId: 42,
      ruleKey: 'total', summary: 'Totals differ.', mismatchFingerprint: 'same',
      expected: { total: 10 }, actual: { total: 11 },
    }, { execute: execute as any, query: query as any });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][1][1]).toBe('ignored');
    expect(String(execute.mock.calls[1][0])).toContain('UPDATE xero_reconciliation_issues');
  });

  it('reopens an ignored issue once when its mismatch fingerprint changes', async () => {
    const execute = vi.fn().mockResolvedValue({ affectedRows: 1 });
    const query = vi.fn()
      .mockResolvedValueOnce([{ id: 4 }])
      .mockResolvedValueOnce([{ id: 9, status: 'ignored', mismatch_fingerprint: 'old', ignored_fingerprint: 'old' }])
      .mockResolvedValueOnce([{ id: 9 }]);

    await recordXeroReconciliationIssue({
      businessId: 'biz-1', targetType: 'sales_order', referenceId: 42,
      ruleKey: 'total', summary: 'Totals differ.', mismatchFingerprint: 'changed',
      expected: { total: 10 }, actual: { total: 12 },
    }, { execute: execute as any, query: query as any });

    expect(execute.mock.calls[1][1][1]).toBe('open');
    expect(execute.mock.calls[2][1]).toEqual(expect.arrayContaining(['biz-1', 9, 'reopened']));
  });

  it('requires a reason to ignore and records the ignored fingerprint', async () => {
    const execute = vi.fn().mockResolvedValue({ affectedRows: 1 });
    const query = vi.fn().mockResolvedValue([{ id: 9, mismatch_fingerprint: 'mismatch-1' }]);

    await expect(ignoreXeroReconciliationIssue({
      businessId: 'biz-1', issueId: 9, actorId: 7, actorName: 'Alex', reason: 'Accepted by bookkeeper',
    }, { execute: execute as any, query: query as any })).resolves.toBe(true);

    expect(String(execute.mock.calls[0][0])).toContain("status = 'ignored'");
    expect(execute.mock.calls[1][1]).toEqual(expect.arrayContaining(['biz-1', 9, '7', 'Alex', 'Accepted by bookkeeper']));
    await expect(ignoreXeroReconciliationIssue({
      businessId: 'biz-1', issueId: 9, reason: '   ',
    }, { execute: execute as any, query: query as any })).rejects.toThrow('reason is required');
  });

  it('resolves a matched issue once and appends a resolution event', async () => {
    const execute = vi.fn().mockResolvedValue({ affectedRows: 1 });
    const query = vi.fn().mockResolvedValue([{ id: 9, status: 'open' }]);

    await expect(resolveXeroReconciliationIssue({
      businessId: 'biz-1', targetType: 'purchase_order', referenceId: 42,
      ruleKey: 'total', actual: { total: 10 }, reason: 'Matched after recheck',
    }, { execute: execute as any, query: query as any })).resolves.toBe(true);

    expect(String(execute.mock.calls[0][0])).toContain("status = 'resolved'");
    expect(String(execute.mock.calls[1][0])).toContain("'resolved'");

    query.mockResolvedValueOnce([{ id: 9, status: 'resolved' }]);
    await expect(resolveXeroReconciliationIssue({
      businessId: 'biz-1', targetType: 'purchase_order', referenceId: 42, ruleKey: 'total',
    }, { execute: execute as any, query: query as any })).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});