import { createHash } from 'crypto';

import { execute, query } from '@/services/MySQLService';

type Dependencies = { execute: typeof execute; query: typeof query };
const defaultDependencies: Dependencies = { execute, query };

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function recordXeroReconciliationIssue(
  input: {
    businessId: string;
    targetType: 'purchase_order' | 'sales_order' | string;
    referenceId: string | number;
    xeroId?: string | null;
    ruleKey: string;
    severity?: 'warning' | 'error' | 'critical';
    summary: string;
    expected?: Record<string, unknown> | null;
    actual?: Record<string, unknown> | null;
    eventType?: 'detected' | 'reopened' | 'override';
    actorId?: string | number | null;
    actorName?: string | null;
    reason?: string | null;
  },
  dependencies: Dependencies = defaultDependencies,
): Promise<number> {
  const referenceId = String(input.referenceId);
  await dependencies.execute(
    `INSERT INTO xero_reconciliation_targets (business_id, target_type, reference_id, xero_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE xero_id = COALESCE(VALUES(xero_id), xero_id), updated_at = NOW()`,
    [input.businessId, input.targetType, referenceId, input.xeroId ?? null],
  );
  const targets = await dependencies.query<{ id: number }>(
    `SELECT id FROM xero_reconciliation_targets
      WHERE business_id = ? AND target_type = ? AND reference_id = ? LIMIT 1`,
    [input.businessId, input.targetType, referenceId],
  );
  if (!targets[0]) throw new Error('Xero reconciliation target could not be loaded.');

  const mismatchFingerprint = fingerprint({
    ruleKey: input.ruleKey,
    expected: input.expected ?? null,
    actual: input.actual ?? null,
    reason: input.reason ?? null,
  });
  await dependencies.execute(
    `INSERT INTO xero_reconciliation_issues
       (business_id, target_id, rule_key, severity, status, summary,
        expected_summary, actual_summary, mismatch_fingerprint)
     VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       severity = VALUES(severity), status = 'open', summary = VALUES(summary),
       expected_summary = VALUES(expected_summary), actual_summary = VALUES(actual_summary),
       mismatch_fingerprint = VALUES(mismatch_fingerprint), resolved_at = NULL,
       last_seen_at = NOW(), occurrence_count = occurrence_count + 1`,
    [
      input.businessId, targets[0].id, input.ruleKey, input.severity ?? 'warning', input.summary,
      input.expected ? JSON.stringify(input.expected) : null,
      input.actual ? JSON.stringify(input.actual) : null,
      mismatchFingerprint,
    ],
  );
  const issues = await dependencies.query<{ id: number }>(
    `SELECT id FROM xero_reconciliation_issues
      WHERE business_id = ? AND target_id = ? AND rule_key = ? LIMIT 1`,
    [input.businessId, targets[0].id, input.ruleKey],
  );
  if (!issues[0]) throw new Error('Xero reconciliation issue could not be loaded.');

  await dependencies.execute(
    `INSERT INTO xero_reconciliation_issue_events
       (business_id, issue_id, event_type, actor_id, actor_name, reason, snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.businessId, issues[0].id, input.eventType ?? 'detected',
      input.actorId == null ? null : String(input.actorId), input.actorName ?? null,
      input.reason?.slice(0, 1000) ?? null,
      JSON.stringify({ expected: input.expected ?? null, actual: input.actual ?? null, mismatchFingerprint }),
    ],
  );
  return issues[0].id;
}