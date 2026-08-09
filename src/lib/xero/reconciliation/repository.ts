import { execute, query } from '@/services/MySQLService';
import { fingerprintReconciliationValue } from './domain';

type Dependencies = { execute: typeof execute; query: typeof query };
const defaultDependencies: Dependencies = { execute, query };

export async function upsertXeroReconciliationTarget(
  input: {
    businessId: string;
    targetType: string;
    referenceId: string | number;
    xeroId?: string | null;
    expected?: Record<string, unknown> | null;
    live?: Record<string, unknown> | null;
    checked?: boolean;
  },
  dependencies: Dependencies = defaultDependencies,
): Promise<number> {
  const hasExpected = input.expected !== undefined;
  const hasLive = input.live !== undefined;
  const expectedJson = input.expected == null ? null : JSON.stringify(input.expected);
  const liveJson = input.live == null ? null : JSON.stringify(input.live);
  await dependencies.execute(
    `INSERT INTO xero_reconciliation_targets
       (business_id, target_type, reference_id, xero_id, expected_snapshot, expected_fingerprint,
        live_snapshot, live_fingerprint, last_checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${input.checked ? 'NOW()' : 'NULL'})
     ON DUPLICATE KEY UPDATE
       xero_id = COALESCE(VALUES(xero_id), xero_id),
       expected_snapshot = ${hasExpected ? 'VALUES(expected_snapshot)' : 'expected_snapshot'},
       expected_fingerprint = ${hasExpected ? 'VALUES(expected_fingerprint)' : 'expected_fingerprint'},
       live_snapshot = ${hasLive ? 'VALUES(live_snapshot)' : 'live_snapshot'},
       live_fingerprint = ${hasLive ? 'VALUES(live_fingerprint)' : 'live_fingerprint'},
       last_checked_at = ${input.checked ? 'NOW()' : 'last_checked_at'}, updated_at = NOW()`,
    [
      input.businessId, input.targetType, String(input.referenceId), input.xeroId ?? null,
      expectedJson, input.expected == null ? null : fingerprintReconciliationValue(input.expected),
      liveJson, input.live == null ? null : fingerprintReconciliationValue(input.live),
    ],
  );
  const targets = await dependencies.query<{ id: number }>(
    `SELECT id FROM xero_reconciliation_targets
      WHERE business_id = ? AND target_type = ? AND reference_id = ? LIMIT 1`,
    [input.businessId, input.targetType, String(input.referenceId)],
  );
  if (!targets[0]) throw new Error('Xero reconciliation target could not be loaded.');
  return targets[0].id;
}

export async function listXeroReconciliationIssueRules(
  input: { businessId: string; targetType: string; referenceId: string | number },
  dependencies: Dependencies = defaultDependencies,
): Promise<Array<{ ruleKey: string; status: 'open' | 'ignored' | 'resolved' }>> {
  const rows = await dependencies.query<{ rule_key: string; status: 'open' | 'ignored' | 'resolved' }>(
    `SELECT issue.rule_key, issue.status
       FROM xero_reconciliation_issues issue
       JOIN xero_reconciliation_targets target ON target.id = issue.target_id
      WHERE issue.business_id = ? AND target.target_type = ? AND target.reference_id = ?`,
    [input.businessId, input.targetType, String(input.referenceId)],
  );
  return rows.map(row => ({ ruleKey: row.rule_key, status: row.status }));
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
    mismatchFingerprint?: string;
  },
  dependencies: Dependencies = defaultDependencies,
): Promise<number> {
  const targetId = await upsertXeroReconciliationTarget({
    businessId: input.businessId,
    targetType: input.targetType,
    referenceId: input.referenceId,
    xeroId: input.xeroId,
  }, dependencies);
  const mismatchFingerprint = input.mismatchFingerprint ?? fingerprintReconciliationValue({
    ruleKey: input.ruleKey,
    expected: input.expected ?? null,
    actual: input.actual ?? null,
  });
  const existingRows = await dependencies.query<{
    id: number;
    status: 'open' | 'ignored' | 'resolved';
    mismatch_fingerprint: string;
    ignored_fingerprint: string | null;
  }>(
    `SELECT id, status, mismatch_fingerprint, ignored_fingerprint
       FROM xero_reconciliation_issues
      WHERE business_id = ? AND target_id = ? AND rule_key = ? LIMIT 1`,
    [input.businessId, targetId, input.ruleKey],
  );
  const existing = existingRows[0];
  const unchangedIgnored = existing?.status === 'ignored'
    && existing.ignored_fingerprint === mismatchFingerprint;
  const explicitOverride = input.eventType === 'override';

  if (existing) {
    const nextStatus = unchangedIgnored && !explicitOverride ? 'ignored' : 'open';
    await dependencies.execute(
      `UPDATE xero_reconciliation_issues
          SET severity = ?, status = ?, summary = ?, expected_summary = ?, actual_summary = ?,
              mismatch_fingerprint = ?, ignored_fingerprint = ?, resolved_at = NULL,
              last_seen_at = NOW(), occurrence_count = occurrence_count + 1
        WHERE business_id = ? AND id = ?`,
      [
        input.severity ?? 'warning', nextStatus, input.summary,
        input.expected ? JSON.stringify(input.expected) : null,
        input.actual ? JSON.stringify(input.actual) : null,
        mismatchFingerprint, nextStatus === 'ignored' ? existing.ignored_fingerprint : null,
        input.businessId, existing.id,
      ],
    );
  } else {
    await dependencies.execute(
      `INSERT INTO xero_reconciliation_issues
         (business_id, target_id, rule_key, severity, status, summary,
          expected_summary, actual_summary, mismatch_fingerprint)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      [
        input.businessId, targetId, input.ruleKey, input.severity ?? 'warning', input.summary,
        input.expected ? JSON.stringify(input.expected) : null,
        input.actual ? JSON.stringify(input.actual) : null,
        mismatchFingerprint,
      ],
    );
  }
  const issues = await dependencies.query<{ id: number }>(
    `SELECT id FROM xero_reconciliation_issues
      WHERE business_id = ? AND target_id = ? AND rule_key = ? LIMIT 1`,
    [input.businessId, targetId, input.ruleKey],
  );
  if (!issues[0]) throw new Error('Xero reconciliation issue could not be loaded.');

  let eventType: 'detected' | 'reopened' | 'override' | null = null;
  if (explicitOverride) eventType = 'override';
  else if (!existing) eventType = input.eventType ?? 'detected';
  else if (!unchangedIgnored && (existing.status !== 'open' || existing.mismatch_fingerprint !== mismatchFingerprint)) eventType = 'reopened';
  if (!eventType) return issues[0].id;

  await dependencies.execute(
    `INSERT INTO xero_reconciliation_issue_events
       (business_id, issue_id, event_type, actor_id, actor_name, reason, snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.businessId, issues[0].id, eventType,
      input.actorId == null ? null : String(input.actorId), input.actorName ?? null,
      input.reason?.slice(0, 1000) ?? null,
      JSON.stringify({ expected: input.expected ?? null, actual: input.actual ?? null, mismatchFingerprint }),
    ],
  );
  return issues[0].id;
}

export async function ignoreXeroReconciliationIssue(
  input: {
    businessId: string;
    issueId: number;
    actorId?: string | number | null;
    actorName?: string | null;
    reason: string;
  },
  dependencies: Dependencies = defaultDependencies,
): Promise<boolean> {
  const reason = input.reason.trim();
  if (!reason) throw new Error('A reason is required to ignore a Xero reconciliation issue.');
  const rows = await dependencies.query<{ id: number; mismatch_fingerprint: string }>(
    `SELECT id, mismatch_fingerprint FROM xero_reconciliation_issues
      WHERE business_id = ? AND id = ? LIMIT 1`,
    [input.businessId, input.issueId],
  );
  if (!rows[0]) return false;
  await dependencies.execute(
    `UPDATE xero_reconciliation_issues
        SET status = 'ignored', ignored_fingerprint = mismatch_fingerprint, resolved_at = NULL
      WHERE business_id = ? AND id = ?`,
    [input.businessId, input.issueId],
  );
  await dependencies.execute(
    `INSERT INTO xero_reconciliation_issue_events
       (business_id, issue_id, event_type, actor_id, actor_name, reason, snapshot)
     VALUES (?, ?, 'ignored', ?, ?, ?, ?)`,
    [
      input.businessId, input.issueId, input.actorId == null ? null : String(input.actorId),
      input.actorName ?? null, reason.slice(0, 1000),
      JSON.stringify({ mismatchFingerprint: rows[0].mismatch_fingerprint }),
    ],
  );
  return true;
}

export async function resolveXeroReconciliationIssue(
  input: {
    businessId: string;
    targetType: string;
    referenceId: string | number;
    ruleKey: string;
    actual?: Record<string, unknown> | null;
    reason?: string | null;
  },
  dependencies: Dependencies = defaultDependencies,
): Promise<boolean> {
  const rows = await dependencies.query<{ id: number; status: string }>(
    `SELECT issue.id, issue.status
       FROM xero_reconciliation_issues issue
       JOIN xero_reconciliation_targets target ON target.id = issue.target_id
      WHERE issue.business_id = ? AND target.target_type = ?
        AND target.reference_id = ? AND issue.rule_key = ? LIMIT 1`,
    [input.businessId, input.targetType, String(input.referenceId), input.ruleKey],
  );
  const issue = rows[0];
  if (!issue || issue.status === 'resolved') return false;
  await dependencies.execute(
    `UPDATE xero_reconciliation_issues
        SET status = 'resolved', resolved_at = NOW(), ignored_fingerprint = NULL
      WHERE business_id = ? AND id = ?`,
    [input.businessId, issue.id],
  );
  await dependencies.execute(
    `INSERT INTO xero_reconciliation_issue_events
       (business_id, issue_id, event_type, reason, snapshot)
     VALUES (?, ?, 'resolved', ?, ?)`,
    [input.businessId, issue.id, input.reason?.slice(0, 1000) ?? null, JSON.stringify({ actual: input.actual ?? null })],
  );
  return true;
}