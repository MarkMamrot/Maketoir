import { describe, expect, it, vi } from 'vitest';

import { listXeroReconciliationIssues, reconciliationRecommendation } from '../repository';

describe('listXeroReconciliationIssues', () => {
  it('defaults to open issues and applies only allowlisted filters', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        id: 9, target_id: 4, target_type: 'purchase_order', reference_id: '42', xero_id: 'bill-42',
        rule_key: 'total', severity: 'error', status: 'open', summary: 'Totals differ.',
        expected_summary: '{"total":10}', actual_summary: { total: 12 },
        first_seen_at: '2026-08-01', last_seen_at: '2026-08-02', last_checked_at: '2026-08-02',
        occurrence_count: 3,
      }])
      .mockResolvedValueOnce([{ total: '1' }]);

    const result = await listXeroReconciliationIssues({
      businessId: 'biz-1', severity: 'error', targetType: 'not-valid', ruleKey: 'total',
      minimumAgeDays: 30, limit: 50, offset: 10,
    }, { query: query as any, execute: vi.fn() as any });

    expect(query.mock.calls[0][1]).toEqual(['biz-1', 'open', 'error', 'total', 30]);
    expect(String(query.mock.calls[0][0])).toContain('LIMIT 50 OFFSET 10');
    expect(String(query.mock.calls[0][0])).not.toContain('not-valid');
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: 9, referenceId: '42', expected: { total: 10 }, actual: { total: 12 },
      recommendedNextStep: expect.stringContaining('amounts'),
    });
  });

  it('supports all states without adding a status predicate', async () => {
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);
    await listXeroReconciliationIssues(
      { businessId: 'biz-1', status: 'all' },
      { query: query as any, execute: vi.fn() as any },
    );
    expect(String(query.mock.calls[0][0])).not.toContain('issue.status = ?');
    expect(query.mock.calls[0][1]).toEqual(['biz-1']);
  });
});

describe('reconciliationRecommendation', () => {
  it('gives lifecycle discrepancies a workflow-specific next step', () => {
    expect(reconciliationRecommendation('lifecycle_state')).toContain('document state');
  });
});