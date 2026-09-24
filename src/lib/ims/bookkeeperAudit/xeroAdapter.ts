import type { AuditFinding } from './domain';
import type { AuditReview } from './repository';
import { listXeroReconciliationIssues, type XeroReconciliationIssueListItem } from '@/lib/xero/reconciliation/repository';
import { loadXeroReconciliationSourceDetails, type XeroReconciliationSourceDetails } from '@/lib/xero/reconciliation/sourceDetails';

const TARGET_LABELS: Record<string, string> = {
  purchase_order: 'Purchase order', sales_order: 'Sales order',
  customer_credit_note: 'Customer credit note', supplier_credit_note: 'Supplier credit note', mapping: 'Xero mapping',
};

const TARGET_HREFS: Record<string, string> = {
  purchase_order: 'purchase-orders', sales_order: 'sales-orders',
  customer_credit_note: 'credit-notes', supplier_credit_note: 'supplier-credit-notes',
};

function numericValue(value: Record<string, unknown> | null): number | null {
  if (!value) return null;
  for (const key of ['total', 'amountDue', 'amountPaid', 'amountCredited', 'remainingCredit']) {
    const amount = Number(value[key]);
    if (Number.isFinite(amount)) return amount;
  }
  return null;
}

export function adaptXeroAuditIssues(
  items: XeroReconciliationIssueListItem[],
  sourceDetails = new Map<string, XeroReconciliationSourceDetails>(),
): { findings: AuditFinding[]; reviews: AuditReview[] } {
  const findings = items.filter(item => item.status !== 'resolved').map(item => {
    const expected = numericValue(item.expected);
    const actual = numericValue(item.actual);
    const details = sourceDetails.get(`${item.targetType}:${item.referenceId}`);
    const sourceView = TARGET_HREFS[item.targetType];
    return {
      key: `xero:${item.id}`,
      fingerprint: item.mismatchFingerprint,
      category: 'accounting_xero',
      severity: item.severity,
      coverage: 'checked',
      title: item.ruleKey.replaceAll('_', ' '),
      summary: item.summary,
      sourceType: item.targetType,
      sourceId: item.referenceId,
      sourceReference: details?.reference ?? `${TARGET_LABELS[item.targetType] ?? item.targetType} #${item.referenceId}`,
      sourceHref: item.ruleKey.startsWith('mapping_') ? '#xero/setup/ledger' : sourceView ? `#${sourceView}/${item.referenceId}` : null,
      xeroHistoryHref: item.ruleKey.startsWith('mapping_') ? null : '#xero/activity/history',
      occurredAt: details?.itemDate ? new Date(details.itemDate).toISOString() : new Date(item.lastSeenAt).toISOString(),
      detectedAt: new Date(item.firstSeenAt).toISOString(),
      dueDate: null,
      expected: expected ?? (item.expected ? JSON.stringify(item.expected) : null),
      actual: actual ?? (item.actual ? JSON.stringify(item.actual) : null),
      variance: expected != null && actual != null ? actual - expected : null,
      valueAtRisk: expected != null && actual != null ? Math.abs(actual - expected) : expected,
      recommendedAction: item.recommendedNextStep,
    } satisfies AuditFinding;
  });
  const reviews = items.filter(item => item.status === 'ignored' && item.ignoredFingerprint === item.mismatchFingerprint).map(item => ({
    id: item.id,
    findingKey: `xero:${item.id}`,
    fingerprint: item.mismatchFingerprint,
    reason: item.ignoredReason ?? 'Accepted in Xero reconciliation',
    actorId: null,
    actorName: item.ignoredActorName,
    acceptedAt: item.ignoredAt == null ? new Date(item.lastSeenAt).toISOString() : new Date(item.ignoredAt).toISOString(),
  } satisfies AuditReview));
  return { findings, reviews };
}

export async function loadXeroAuditFindings(businessId: string, imsDbName: string) {
  const result = await listXeroReconciliationIssues({ businessId, status: 'all', limit: 500 });
  const sourceDetails = await loadXeroReconciliationSourceDetails(businessId, imsDbName, result.items);
  return adaptXeroAuditIssues(result.items, sourceDetails);
}