import { describe, expect, it } from 'vitest';
import { adaptXeroAuditIssues } from '../xeroAdapter';
import type { XeroReconciliationIssueListItem } from '@/lib/xero/reconciliation/repository';

function issue(overrides: Partial<XeroReconciliationIssueListItem> = {}): XeroReconciliationIssueListItem {
  return {
    id: 9, targetId: 4, targetType: 'sales_order', referenceId: '42', xeroId: 'invoice-42',
    ruleKey: 'total', severity: 'error', status: 'open', summary: 'Totals differ.',
    expected: { total: 10 }, actual: { total: 12 }, firstSeenAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: '2026-09-02T00:00:00.000Z', lastCheckedAt: '2026-09-02T00:00:00.000Z', occurrenceCount: 2,
    recommendedNextStep: 'Compare amounts.', mismatchFingerprint: 'a'.repeat(64), ignoredFingerprint: null,
    ignoredReason: null, ignoredActorName: null, ignoredAt: null, ...overrides,
  };
}

describe('adaptXeroAuditIssues', () => {
  it('maps amount mismatches and their value at risk', () => {
    const result = adaptXeroAuditIssues([issue()], new Map([['sales_order:42', {
      reference: 'SO-00042', contactName: 'Example Customer', amount: 10, itemDate: '2026-08-27', status: 'fulfilled',
    }]]));
    expect(result.findings[0]).toMatchObject({
      key: 'xero:9', category: 'accounting_xero', expected: 10, actual: 12, variance: 2, valueAtRisk: 2,
      sourceReference: 'SO-00042', sourceContext: 'Example Customer', sourceHref: '#sales-orders/42', xeroHistoryHref: '#xero/activity/history',
      xeroHref: 'https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=invoice-42',
      occurredAt: '2026-08-27T00:00:00.000Z', detectedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(result.reviews).toEqual([]);
  });

  it('omits an orphaned reconciliation issue when its local source no longer exists', () => {
    const result = adaptXeroAuditIssues([issue({
      ruleKey: 'lifecycle_state', xeroId: 'invoice-42',
      expected: { status: 'AUTHORISED', compatibleStatuses: ['AUTHORISED', 'PAID'] },
      targetExpected: { status: 'AUTHORISED' },
      actual: { status: 'VOIDED' },
    })]);
    expect(result.findings).toEqual([]);
  });

  it('maps an unchanged ignored issue to an accepted review', () => {
    const fingerprint = 'b'.repeat(64);
    const result = adaptXeroAuditIssues([issue({
      status: 'ignored', mismatchFingerprint: fingerprint, ignoredFingerprint: fingerprint,
      ignoredReason: 'Known timing difference', ignoredActorName: 'Alex', ignoredAt: '2026-09-03T00:00:00.000Z',
    })]);
    expect(result.reviews).toEqual([expect.objectContaining({
      findingKey: 'xero:9', fingerprint, reason: 'Known timing difference', actorName: 'Alex',
    })]);
  });
});