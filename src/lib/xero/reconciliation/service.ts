import {
  canonicalDocumentSnapshot,
  compareDocumentSnapshots,
  type ReconciliationDocumentSnapshot,
} from './domain';
import {
  listXeroReconciliationIssueRules,
  recordXeroReconciliationIssue,
  resolveXeroReconciliationIssue,
  upsertXeroReconciliationTarget,
} from './repository';

type Dependencies = {
  upsertTarget: typeof upsertXeroReconciliationTarget;
  listIssueRules: typeof listXeroReconciliationIssueRules;
  recordIssue: typeof recordXeroReconciliationIssue;
  resolveIssue: typeof resolveXeroReconciliationIssue;
};

const defaultDependencies: Dependencies = {
  upsertTarget: upsertXeroReconciliationTarget,
  listIssueRules: listXeroReconciliationIssueRules,
  recordIssue: recordXeroReconciliationIssue,
  resolveIssue: resolveXeroReconciliationIssue,
};

const DOMAIN_RULES = new Set([
  'missing_document', 'linked_document', 'document_type', 'total', 'currency', 'contact',
  'lifecycle_state', 'amount_due', 'amount_paid', 'amount_credited', 'remaining_credit',
]);

export async function reconcileXeroDocument(
  input: {
    businessId: string;
    targetType: string;
    referenceId: string | number;
    xeroId: string;
    expected: ReconciliationDocumentSnapshot;
    actual: ReconciliationDocumentSnapshot | null;
  },
  dependencies: Dependencies = defaultDependencies,
): Promise<{ mismatchCount: number; openedRuleKeys: string[]; resolvedRuleKeys: string[] }> {
  const expected = canonicalDocumentSnapshot(input.expected);
  const actual = input.actual ? canonicalDocumentSnapshot(input.actual) : null;
  const mismatches = compareDocumentSnapshots(expected, actual);

  await dependencies.upsertTarget({
    businessId: input.businessId,
    targetType: input.targetType,
    referenceId: input.referenceId,
    xeroId: input.xeroId,
    expected,
    live: actual,
    checked: true,
  });
  const existingRules = await dependencies.listIssueRules({
    businessId: input.businessId,
    targetType: input.targetType,
    referenceId: input.referenceId,
  });

  for (const issue of mismatches) {
    await dependencies.recordIssue({
      businessId: input.businessId,
      targetType: input.targetType,
      referenceId: input.referenceId,
      xeroId: input.xeroId,
      ruleKey: issue.ruleKey,
      severity: issue.severity,
      summary: issue.summary,
      expected: issue.expected,
      actual: issue.actual,
      mismatchFingerprint: issue.fingerprint,
    });
  }

  const currentRules = new Set(mismatches.map(issue => issue.ruleKey));
  const resolvedRuleKeys: string[] = [];
  for (const existing of existingRules) {
    if (existing.status === 'resolved' || currentRules.has(existing.ruleKey)) continue;
    if (mismatches.length > 0 && !DOMAIN_RULES.has(existing.ruleKey)) continue;
    const resolved = await dependencies.resolveIssue({
      businessId: input.businessId,
      targetType: input.targetType,
      referenceId: input.referenceId,
      ruleKey: existing.ruleKey,
      actual: actual ?? { found: false },
      reason: 'Matched during Xero recheck.',
    });
    if (resolved) resolvedRuleKeys.push(existing.ruleKey);
  }

  return {
    mismatchCount: mismatches.length,
    openedRuleKeys: mismatches.map(issue => issue.ruleKey),
    resolvedRuleKeys,
  };
}