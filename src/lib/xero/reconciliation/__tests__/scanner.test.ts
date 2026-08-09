import { describe, expect, it, vi } from 'vitest';

import { canonicalDocumentSnapshot } from '../domain';
import { scanXeroReconciliationTargets } from '../scanner';

function target(id: number, targetType = 'sales_order') {
  return {
    id,
    targetType,
    referenceId: String(id),
    xeroId: `xero-${id}`,
    expected: canonicalDocumentSnapshot({
      xeroId: `xero-${id}`, documentType: targetType === 'sales_order' ? 'ACCREC' : 'ACCRECCREDIT',
      currencyCode: 'AUD', total: 10, compatibleStatuses: ['AUTHORISED'],
    }),
  };
}

function document(id: number, credit = false) {
  return credit
    ? { CreditNoteID: `xero-${id}`, Type: 'ACCRECCREDIT', CurrencyCode: 'AUD', Total: 10, Status: 'AUTHORISED', RemainingCredit: 10 }
    : { InvoiceID: `xero-${id}`, Type: 'ACCREC', CurrencyCode: 'AUD', Total: 10, Status: 'AUTHORISED', AmountDue: 10, AmountPaid: 0, AmountCredited: 0 };
}

describe('scanXeroReconciliationTargets', () => {
  const noMappings = () => vi.fn().mockResolvedValue({ items: [] });

  it('caps Xero fetches at 20 IDs and reconciles every successful target', async () => {
    const targets = Array.from({ length: 21 }, (_, index) => target(index + 1));
    const xeroFetch = vi.fn().mockImplementation(async (_businessId: string, endpoint: string) => {
      const ids = endpoint.match(/IDs=([^&]+)/)?.[1].split(',').map(value => Number(value.replace('xero-', ''))) ?? [];
      return { Invoices: ids.map(id => document(id)) };
    });
    const reconcile = vi.fn().mockResolvedValue({ mismatchCount: 0, openedRuleKeys: [], resolvedRuleKeys: [] });

    const result = await scanXeroReconciliationTargets({ businessId: 'biz-1', limit: 100 }, {
      listTargets: vi.fn().mockResolvedValue(targets) as any, xeroFetch: xeroFetch as any, reconcile: reconcile as any,
      mappingReadiness: noMappings() as any,
    });

    expect(xeroFetch).toHaveBeenCalledTimes(2);
    expect(xeroFetch.mock.calls[0][1].match(/xero-/g)).toHaveLength(20);
    expect(reconcile).toHaveBeenCalledTimes(21);
    expect(result).toMatchObject({ targetCount: 21, checkedCount: 21, failedBatches: 0, nextCursor: 21 });
  });

  it('does not mark any target missing when its whole Xero chunk fails', async () => {
    const targets = Array.from({ length: 21 }, (_, index) => target(index + 1));
    const xeroFetch = vi.fn()
      .mockRejectedValueOnce(new Error('Xero unavailable'))
      .mockResolvedValueOnce({ Invoices: [document(21)] });
    const reconcile = vi.fn().mockResolvedValue({ mismatchCount: 0, openedRuleKeys: [], resolvedRuleKeys: [] });
    const reportIssue = vi.fn().mockResolvedValue(undefined);

    const result = await scanXeroReconciliationTargets({ businessId: 'biz-1' }, {
      listTargets: vi.fn().mockResolvedValue(targets) as any, xeroFetch: xeroFetch as any,
      reconcile: reconcile as any, reportIssue: reportIssue as any,
      mappingReadiness: noMappings() as any,
    });

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][0]).toMatchObject({ xeroId: 'xero-21', actual: expect.any(Object) });
    expect(result).toMatchObject({ checkedCount: 1, failedBatches: 1 });
    expect(reportIssue).toHaveBeenCalledWith(expect.objectContaining({ operation: 'scan_document_batch' }));
  });

  it('marks an unreturned ID missing only after a successful chunk response', async () => {
    const reconcile = vi.fn().mockResolvedValue({ mismatchCount: 1, openedRuleKeys: ['missing_document'], resolvedRuleKeys: [] });
    const targets = [target(1, 'customer_credit_note'), target(2, 'customer_credit_note')];

    const result = await scanXeroReconciliationTargets({ businessId: 'biz-1' }, {
      listTargets: vi.fn().mockResolvedValue(targets) as any,
      xeroFetch: vi.fn().mockResolvedValue({ CreditNotes: [document(1, true)] }) as any,
      reconcile: reconcile as any,
      mappingReadiness: noMappings() as any,
    });

    expect(reconcile.mock.calls[0][0].actual).toEqual(expect.objectContaining({ xeroId: 'xero-1', documentType: 'ACCRECCREDIT' }));
    expect(reconcile.mock.calls[1][0].actual).toBeNull();
    expect(result).toMatchObject({ checkedCount: 2, mismatchCount: 2, failedBatches: 0 });
  });

  it('records stale mapping issues and resolves recovered mapping rules', async () => {
    const recordMappingIssue = vi.fn().mockResolvedValue(1);
    const resolveMappingIssue = vi.fn().mockResolvedValue(true);
    const result = await scanXeroReconciliationTargets({ businessId: 'biz-1' }, {
      listTargets: vi.fn().mockResolvedValue([]) as any,
      mappingReadiness: vi.fn().mockResolvedValue({ items: [
        { category: 'account', key: 'sales_revenue', label: 'Sales Revenue', requirement: 'required', status: 'stale', summary: 'Archived account.' },
        { category: 'tracking', key: 'channel:online', label: 'Online Sales', requirement: 'optional', status: 'ready', summary: 'Ready.' },
      ] }) as any,
      recordMappingIssue: recordMappingIssue as any,
      resolveMappingIssue: resolveMappingIssue as any,
    });

    expect(recordMappingIssue).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'mapping', referenceId: 'account:sales_revenue', ruleKey: 'mapping_stale', severity: 'error',
    }));
    expect(resolveMappingIssue).toHaveBeenCalledWith(expect.objectContaining({ referenceId: 'account:sales_revenue', ruleKey: 'mapping_missing' }));
    expect(resolveMappingIssue).toHaveBeenCalledWith(expect.objectContaining({ referenceId: 'tracking:channel:online', ruleKey: 'mapping_stale' }));
    expect(result.mappingIssueCount).toBe(1);
  });
});