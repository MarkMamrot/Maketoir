import { describe, expect, it, vi } from 'vitest';

import { canonicalDocumentSnapshot } from '../domain';
import { reconcileXeroDocument } from '../service';

const expected = canonicalDocumentSnapshot({
  xeroId: 'invoice-1', documentType: 'ACCREC', currencyCode: 'AUD', total: 110,
  compatibleStatuses: ['AUTHORISED'], amountDue: 110,
});

function dependencies(existingRules: Array<{ ruleKey: string; status: 'open' | 'ignored' | 'resolved' }> = []) {
  return {
    upsertTarget: vi.fn().mockResolvedValue(4),
    listIssueRules: vi.fn().mockResolvedValue(existingRules),
    recordIssue: vi.fn().mockResolvedValue(9),
    resolveIssue: vi.fn().mockResolvedValue(true),
  };
}

describe('reconcileXeroDocument', () => {
  it('persists snapshots, records mismatches, and resolves disappeared domain rules', async () => {
    const deps = dependencies([
      { ruleKey: 'total', status: 'open' },
      { ruleKey: 'amount_due', status: 'open' },
      { ruleKey: 'admin_edit_override', status: 'open' },
    ]);
    const actual = canonicalDocumentSnapshot({
      ...expected, status: 'AUTHORISED', total: 120, amountDue: 110,
    });

    const result = await reconcileXeroDocument({
      businessId: 'biz-1', targetType: 'sales_order', referenceId: 42,
      xeroId: 'invoice-1', expected, actual,
    }, deps as any);

    expect(result).toEqual({ mismatchCount: 1, openedRuleKeys: ['total'], resolvedRuleKeys: ['amount_due'] });
    expect(deps.upsertTarget).toHaveBeenCalledWith(expect.objectContaining({ live: actual, checked: true }));
    expect(deps.recordIssue).toHaveBeenCalledWith(expect.objectContaining({ ruleKey: 'total', mismatchFingerprint: expect.any(String) }));
    expect(deps.resolveIssue).toHaveBeenCalledTimes(1);
  });

  it('resolves workflow issues once the document fully matches', async () => {
    const deps = dependencies([
      { ruleKey: 'admin_edit_override', status: 'open' },
      { ruleKey: 'post_edit_sync_failed', status: 'ignored' },
    ]);
    const actual = canonicalDocumentSnapshot({ ...expected, status: 'AUTHORISED' });

    const result = await reconcileXeroDocument({
      businessId: 'biz-1', targetType: 'sales_order', referenceId: 42,
      xeroId: 'invoice-1', expected, actual,
    }, deps as any);

    expect(result.resolvedRuleKeys).toEqual(['admin_edit_override', 'post_edit_sync_failed']);
    expect(deps.recordIssue).not.toHaveBeenCalled();
  });

  it('records one missing-document issue and explicitly clears the live snapshot', async () => {
    const deps = dependencies();

    const result = await reconcileXeroDocument({
      businessId: 'biz-1', targetType: 'sales_order', referenceId: 42,
      xeroId: 'invoice-1', expected, actual: null,
    }, deps as any);

    expect(result.openedRuleKeys).toEqual(['missing_document']);
    expect(deps.upsertTarget).toHaveBeenCalledWith(expect.objectContaining({ live: null, checked: true }));
    expect(deps.recordIssue).toHaveBeenCalledTimes(1);
  });
});