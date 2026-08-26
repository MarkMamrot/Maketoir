import { describe, expect, it, vi } from 'vitest';

import {
  claimXeroReconciliationDelivery,
  completeXeroReconciliationDelivery,
  getXeroReconciliationIssuesForEmail,
  getXeroReconciliationRecipients,
  getXeroReconciliationIssueActionContext,
  getXeroReconciliationEmailSettings,
  listOpenXeroReconciliationIssuesForDigest,
  ignoreXeroReconciliationIssue,
  insertXeroReconciliationTargetIfAbsent,
  listXeroReconciliationTargets,
  recordXeroReconciliationActionEvent,
  recordXeroReconciliationEmailEvents,
  recordXeroReconciliationIssue,
  resolveXeroReconciliationIssue,
  saveXeroReconciliationEmailSettings,
  saveXeroReconciliationRecipients,
} from '../repository';

describe('listXeroReconciliationTargets', () => {
  it('uses a clamped literal limit for MySQL prepared-statement compatibility', async () => {
    const query = vi.fn().mockResolvedValue([]);

    await listXeroReconciliationTargets(
      { businessId: 'biz-1', afterId: 12, limit: 900 },
      { query: query as any, execute: vi.fn() as any },
    );

    expect(String(query.mock.calls[0][0])).toContain('LIMIT 500');
    expect(String(query.mock.calls[0][0])).not.toContain('LIMIT ?');
    expect(query.mock.calls[0][1]).toEqual(['biz-1', 12]);
  });
});

describe('reconciliation email persistence', () => {
  it('loads typed digest settings and persists the complete email schedule', async () => {
    const query = vi.fn().mockResolvedValue([{
      recipients_json: '["accounts@example.com"]', digest_frequency: 'weekly',
      digest_timezone: 'Australia/Perth', digest_hour: 9, digest_weekly_day: 5,
      last_digest_completed_at: '2026-08-08 01:00:00',
    }]);
    const execute = vi.fn().mockResolvedValue({ affectedRows: 1 });
    const dependencies = { query: query as any, execute: execute as any };

    await expect(getXeroReconciliationEmailSettings('biz-1', dependencies)).resolves.toEqual({
      recipients: ['accounts@example.com'], digestFrequency: 'weekly', digestTimeZone: 'Australia/Perth',
      digestHour: 9, digestWeeklyDay: 5, lastDigestCompletedAt: '2026-08-08 01:00:00',
    });
    await saveXeroReconciliationEmailSettings({
      businessId: 'biz-1', recipients: ['accounts@example.com'], digestFrequency: 'daily',
      digestTimeZone: 'Australia/Sydney', digestHour: 8, digestWeeklyDay: 1,
    }, dependencies);
    expect(execute.mock.calls[0][1]).toEqual([
      'biz-1', '["accounts@example.com"]', 'daily', 'Australia/Sydney', 8, 1,
    ]);
    expect(String(execute.mock.calls[0][0])).toContain('digest_frequency = VALUES(digest_frequency)');
  });

  it('stores recipients and loads selected open issues within the tenant', async () => {
    const execute = vi.fn().mockResolvedValue({ affectedRows: 1 });
    const query = vi.fn()
      .mockResolvedValueOnce([{ recipients_json: '["accounts@example.com"]' }])
      .mockResolvedValueOnce([{
        id: 9, severity: 'error', rule_key: 'total', summary: 'Totals differ.',
        expected_summary: '{"total":12.5}', actual_summary: '{"total":10}',
        target_type: 'sales_order', reference_id: '42',
      }]);
    const dependencies = { execute: execute as any, query: query as any };

    await saveXeroReconciliationRecipients({ businessId: 'biz-1', recipients: ['accounts@example.com'] }, dependencies);
    await expect(getXeroReconciliationRecipients('biz-1', dependencies)).resolves.toEqual(['accounts@example.com']);
    await expect(getXeroReconciliationIssuesForEmail({ businessId: 'biz-1', issueIds: [9] }, dependencies)).resolves.toEqual([expect.objectContaining({
      id: 9, targetType: 'sales_order', referenceId: '42', amount: 12.5,
    })]);
    expect(query.mock.calls[1][1]).toEqual(['biz-1', 9]);
    expect(String(query.mock.calls[1][0])).toContain("issue.status = 'open'");
  });

  it('claims once, suppresses a replay, and appends emailed events after success', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValue({ affectedRows: 1 });
    const query = vi.fn();
    const dependencies = { execute: execute as any, query: query as any };
    const claim = {
      businessId: 'biz-1', deliveryKey: 'manual-request-123', payloadFingerprint: 'fingerprint',
      recipients: ['accounts@example.com'], issueIds: [9], actorId: 7, actorName: 'Alex',
    };

    await expect(claimXeroReconciliationDelivery(claim, dependencies)).resolves.toBe('claimed');
    await completeXeroReconciliationDelivery({ businessId: 'biz-1', deliveryKey: 'manual-request-123', providerMessageId: 'email-1' }, dependencies);
    await recordXeroReconciliationEmailEvents(claim, dependencies);

    expect(String(execute.mock.calls[0][0])).toContain('INSERT IGNORE');
    expect(execute.mock.calls[0][1][2]).toBe('manual');
    expect(String(execute.mock.calls[1][0])).toContain("status = 'sent'");
    expect(String(execute.mock.calls[2][0])).toContain("'emailed'");
    expect(JSON.parse(execute.mock.calls[2][1][4])).toEqual({ deliveryKey: 'manual-request-123', recipients: ['accounts@example.com'] });

    execute.mockReset();
    execute.mockResolvedValueOnce({ affectedRows: 0 }).mockResolvedValueOnce({ affectedRows: 0 });
    query.mockResolvedValueOnce([{ status: 'sent', payload_fingerprint: 'fingerprint' }]);
    await expect(claimXeroReconciliationDelivery(claim, dependencies)).resolves.toBe('already_sent');
  });

  it('lists only open digest issues with their mismatch fingerprints', async () => {
    const query = vi.fn().mockResolvedValue([{
      id: 9, severity: 'error', rule_key: 'total', summary: 'Totals differ.',
      expected_summary: '{"total":12.5}', actual_summary: null, mismatch_fingerprint: 'mismatch-9',
      target_type: 'sales_order', reference_id: '42',
    }]);
    await expect(listOpenXeroReconciliationIssuesForDigest('biz-1', { query: query as any, execute: vi.fn() as any })).resolves.toEqual([
      expect.objectContaining({ id: 9, mismatchFingerprint: 'mismatch-9', amount: 12.5 }),
    ]);
    expect(query.mock.calls[0][1]).toEqual(['biz-1']);
    expect(String(query.mock.calls[0][0])).toContain("issue.status = 'open'");
  });
});

describe('reconciliation action audit', () => {
  it('loads tenant-scoped target context and appends an actor action event', async () => {
    const query = vi.fn().mockResolvedValue([{
      id: 9, status: 'open', rule_key: 'lifecycle_state', target_type: 'sales_order',
      reference_id: '42', xero_id: 'invoice-42',
    }]);
    const execute = vi.fn().mockResolvedValue({ affectedRows: 1 });
    const dependencies = { query: query as any, execute: execute as any };

    await expect(getXeroReconciliationIssueActionContext({ businessId: 'biz-1', issueId: 9 }, dependencies)).resolves.toEqual({
      issueId: 9, status: 'open', ruleKey: 'lifecycle_state', targetType: 'sales_order',
      referenceId: '42', xeroId: 'invoice-42',
    });
    await recordXeroReconciliationActionEvent({
      businessId: 'biz-1', issueId: 9, actorId: 7, actorName: 'Alex', action: 'authorise',
      reason: 'Approved after review', targetType: 'sales_order', referenceId: 42, xeroId: 'invoice-42',
    }, dependencies);

    expect(query.mock.calls[0][1]).toEqual(['biz-1', 9]);
    expect(String(execute.mock.calls[0][0])).toContain("'retried'");
    expect(execute.mock.calls[0][1]).toEqual(expect.arrayContaining(['biz-1', 9, '7', 'Alex', 'Approved after review']));
    expect(JSON.parse(execute.mock.calls[0][1][5])).toMatchObject({ action: 'authorise', targetType: 'sales_order', referenceId: '42' });
  });
});

describe('insertXeroReconciliationTargetIfAbsent', () => {
  it('uses duplicate-safe insertion and reports whether the neutral target was created', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 0 });
    const dependencies = { execute: execute as any, query: vi.fn() as any };
    const input = {
      businessId: 'biz-1', targetType: 'purchase_order', referenceId: 42,
      xeroId: 'bill-42', expected: { xeroId: 'bill-42', status: null },
    };

    await expect(insertXeroReconciliationTargetIfAbsent(input, dependencies)).resolves.toBe(true);
    await expect(insertXeroReconciliationTargetIfAbsent(input, dependencies)).resolves.toBe(false);
    expect(String(execute.mock.calls[0][0])).toContain('INSERT IGNORE');
  });
});

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
    const query = vi.fn().mockResolvedValue([{ id: 9, status: 'open', mismatch_fingerprint: 'mismatch-1' }]);

    await expect(ignoreXeroReconciliationIssue({
      businessId: 'biz-1', issueId: 9, actorId: 7, actorName: 'Alex', reason: 'Accepted by bookkeeper',
    }, { execute: execute as any, query: query as any })).resolves.toBe(true);

    expect(String(execute.mock.calls[0][0])).toContain("status = 'ignored'");
    expect(execute.mock.calls[1][1]).toEqual(expect.arrayContaining(['biz-1', 9, '7', 'Alex', 'Accepted by bookkeeper']));
    await expect(ignoreXeroReconciliationIssue({
      businessId: 'biz-1', issueId: 9, reason: '   ',
    }, { execute: execute as any, query: query as any })).rejects.toThrow('reason is required');
  });

  it('does not append another event when an issue is already ignored', async () => {
    const execute = vi.fn();
    const query = vi.fn().mockResolvedValue([{ id: 9, status: 'ignored', mismatch_fingerprint: 'mismatch-1' }]);

    await expect(ignoreXeroReconciliationIssue({
      businessId: 'biz-1', issueId: 9, reason: 'Accepted by bookkeeper',
    }, { execute: execute as any, query: query as any })).resolves.toBe(false);

    expect(execute).not.toHaveBeenCalled();
  });

  it('does not append an event when another request wins the open-state transition', async () => {
    const execute = vi.fn().mockResolvedValue({ affectedRows: 0 });
    const query = vi.fn().mockResolvedValue([{ id: 9, status: 'open', mismatch_fingerprint: 'mismatch-1' }]);

    await expect(ignoreXeroReconciliationIssue({
      businessId: 'biz-1', issueId: 9, reason: 'Accepted by bookkeeper',
    }, { execute: execute as any, query: query as any })).resolves.toBe(false);

    expect(execute).toHaveBeenCalledOnce();
    expect(String(execute.mock.calls[0][0])).toContain("status = 'open'");
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