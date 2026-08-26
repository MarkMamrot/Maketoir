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

export async function insertXeroReconciliationTargetIfAbsent(
  input: {
    businessId: string;
    targetType: string;
    referenceId: string | number;
    xeroId: string;
    expected: Record<string, unknown>;
  },
  dependencies: Dependencies = defaultDependencies,
): Promise<boolean> {
  const result = await dependencies.execute(
    `INSERT IGNORE INTO xero_reconciliation_targets
       (business_id, target_type, reference_id, xero_id, expected_snapshot, expected_fingerprint)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.businessId, input.targetType, String(input.referenceId), input.xeroId,
      JSON.stringify(input.expected), fingerprintReconciliationValue(input.expected),
    ],
  );
  return result.affectedRows > 0;
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

export async function listXeroReconciliationTargets(
  input: { businessId: string; afterId?: number; limit?: number },
  dependencies: Dependencies = defaultDependencies,
): Promise<Array<{
  id: number;
  targetType: string;
  referenceId: string;
  xeroId: string;
  expected: Record<string, unknown>;
}>> {
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
  const rows = await dependencies.query<{
    id: number;
    target_type: string;
    reference_id: string;
    xero_id: string;
    expected_snapshot: string | Record<string, unknown>;
  }>(
    `SELECT id, target_type, reference_id, xero_id, expected_snapshot
       FROM xero_reconciliation_targets
      WHERE business_id = ? AND id > ? AND xero_id IS NOT NULL AND expected_snapshot IS NOT NULL
      ORDER BY id ASC
      LIMIT ${limit}`,
    [input.businessId, Math.max(0, Math.floor(input.afterId ?? 0))],
  );
  return rows.map(row => ({
    id: Number(row.id),
    targetType: row.target_type,
    referenceId: String(row.reference_id),
    xeroId: row.xero_id,
    expected: typeof row.expected_snapshot === 'string'
      ? JSON.parse(row.expected_snapshot) as Record<string, unknown>
      : row.expected_snapshot,
  }));
}

export async function getXeroReconciliationTargetExpected(
  input: { businessId: string; targetType: string; referenceId: string | number },
  dependencies: Dependencies = defaultDependencies,
): Promise<Record<string, unknown> | null> {
  const rows = await dependencies.query<{ expected_snapshot: string | Record<string, unknown> | null }>(
    `SELECT expected_snapshot FROM xero_reconciliation_targets
      WHERE business_id = ? AND target_type = ? AND reference_id = ? LIMIT 1`,
    [input.businessId, input.targetType, String(input.referenceId)],
  );
  const snapshot = rows[0]?.expected_snapshot;
  if (!snapshot) return null;
  return typeof snapshot === 'string' ? JSON.parse(snapshot) as Record<string, unknown> : snapshot;
}

export type XeroReconciliationIssueListItem = {
  id: number;
  targetId: number;
  targetType: string;
  referenceId: string;
  xeroId: string | null;
  ruleKey: string;
  severity: 'warning' | 'error' | 'critical';
  status: 'open' | 'ignored' | 'resolved';
  summary: string;
  expected: Record<string, unknown> | null;
  actual: Record<string, unknown> | null;
  firstSeenAt: string | Date;
  lastSeenAt: string | Date;
  lastCheckedAt: string | Date | null;
  occurrenceCount: number;
  recommendedNextStep: string;
};

const ISSUE_STATUSES = new Set(['open', 'ignored', 'resolved']);
const ISSUE_SEVERITIES = new Set(['warning', 'error', 'critical']);
const ISSUE_TARGET_TYPES = new Set(['purchase_order', 'sales_order', 'customer_credit_note', 'supplier_credit_note', 'mapping']);
const ISSUE_RULES = new Set([
  'missing_document', 'linked_document', 'document_type', 'total', 'currency', 'contact',
  'lifecycle_state', 'amount_due', 'amount_paid', 'amount_credited', 'remaining_credit',
  'admin_edit_override',
  'mapping_missing', 'mapping_stale',
]);

function parseJsonObject(value: string | Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) return null;
  return typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value;
}

export function reconciliationRecommendation(ruleKey: string): string {
  if (ruleKey === 'missing_document' || ruleKey === 'linked_document') return 'Check the stored link and the document in Xero, then recheck.';
  if (ruleKey === 'document_type' || ruleKey === 'contact') return 'Confirm the correct Xero document and contact before changing the link.';
  if (ruleKey === 'lifecycle_state') return 'Review the document state in Xero and complete or reverse the pending workflow.';
  if (ruleKey === 'admin_edit_override') return 'Ask an Admin to review the local override and its Xero impact.';
  if (ruleKey === 'mapping_missing' || ruleKey === 'mapping_stale') return 'Open Xero Ledger Mapping, select an active Xero value, then recheck.';
  return 'Compare the local and Xero amounts, correct the source of truth, then recheck.';
}

export async function listXeroReconciliationIssues(
  input: {
    businessId: string;
    status?: string;
    severity?: string;
    targetType?: string;
    ruleKey?: string;
    minimumAgeDays?: number;
    limit?: number;
    offset?: number;
  },
  dependencies: Dependencies = defaultDependencies,
): Promise<{ items: XeroReconciliationIssueListItem[]; total: number }> {
  const where = ['issue.business_id = ?'];
  const params: unknown[] = [input.businessId];
  if (input.status !== 'all') {
    const status = ISSUE_STATUSES.has(input.status ?? '') ? input.status! : 'open';
    where.push('issue.status = ?');
    params.push(status);
  }
  if (ISSUE_SEVERITIES.has(input.severity ?? '')) {
    where.push('issue.severity = ?');
    params.push(input.severity);
  }
  if (ISSUE_TARGET_TYPES.has(input.targetType ?? '')) {
    where.push('target.target_type = ?');
    params.push(input.targetType);
  }
  if (ISSUE_RULES.has(input.ruleKey ?? '')) {
    where.push('issue.rule_key = ?');
    params.push(input.ruleKey);
  }
  const minimumAgeDays = Math.max(0, Math.min(3650, Math.floor(input.minimumAgeDays ?? 0)));
  if (minimumAgeDays > 0) {
    where.push('issue.first_seen_at <= DATE_SUB(NOW(), INTERVAL ? DAY)');
    params.push(minimumAgeDays);
  }
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const fromSql = `FROM xero_reconciliation_issues issue
      JOIN xero_reconciliation_targets target ON target.id = issue.target_id
     WHERE ${where.join(' AND ')}`;
  const rows = await dependencies.query<any>(
    `SELECT issue.id, issue.target_id, issue.rule_key, issue.severity, issue.status, issue.summary,
            issue.expected_summary, issue.actual_summary, issue.first_seen_at, issue.last_seen_at,
            issue.occurrence_count, target.target_type, target.reference_id, target.xero_id,
            target.last_checked_at
       ${fromSql}
      ORDER BY FIELD(issue.severity, 'critical', 'error', 'warning'), issue.first_seen_at ASC, issue.id ASC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const countRows = await dependencies.query<{ total: number | string }>(
    `SELECT COUNT(*) AS total ${fromSql}`,
    params,
  );
  return {
    total: Number(countRows[0]?.total ?? 0),
    items: rows.map((row: any) => ({
      id: Number(row.id), targetId: Number(row.target_id), targetType: row.target_type,
      referenceId: String(row.reference_id), xeroId: row.xero_id ? String(row.xero_id) : null,
      ruleKey: row.rule_key, severity: row.severity, status: row.status, summary: row.summary,
      expected: parseJsonObject(row.expected_summary), actual: parseJsonObject(row.actual_summary),
      firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
      lastCheckedAt: row.last_checked_at, occurrenceCount: Number(row.occurrence_count),
      recommendedNextStep: reconciliationRecommendation(row.rule_key),
    })),
  };
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
  const rows = await dependencies.query<{ id: number; status: string; mismatch_fingerprint: string }>(
    `SELECT id, status, mismatch_fingerprint FROM xero_reconciliation_issues
      WHERE business_id = ? AND id = ? LIMIT 1`,
    [input.businessId, input.issueId],
  );
  if (!rows[0] || rows[0].status !== 'open') return false;
  const updated = await dependencies.execute(
    `UPDATE xero_reconciliation_issues
        SET status = 'ignored', ignored_fingerprint = mismatch_fingerprint, resolved_at = NULL
      WHERE business_id = ? AND id = ? AND status = 'open'`,
    [input.businessId, input.issueId],
  );
  if (updated.affectedRows === 0) return false;
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

export async function getXeroReconciliationIssueActionContext(
  input: { businessId: string; issueId: number },
  dependencies: Dependencies = defaultDependencies,
): Promise<{
  issueId: number;
  status: 'open' | 'ignored' | 'resolved';
  ruleKey: string;
  targetType: string;
  referenceId: string;
  xeroId: string | null;
} | null> {
  const rows = await dependencies.query<any>(
    `SELECT issue.id, issue.status, issue.rule_key, target.target_type, target.reference_id, target.xero_id
       FROM xero_reconciliation_issues issue
       JOIN xero_reconciliation_targets target ON target.id = issue.target_id
      WHERE issue.business_id = ? AND issue.id = ? LIMIT 1`,
    [input.businessId, input.issueId],
  );
  const row = rows[0];
  return row ? {
    issueId: Number(row.id), status: row.status, ruleKey: row.rule_key,
    targetType: row.target_type, referenceId: String(row.reference_id),
    xeroId: row.xero_id ? String(row.xero_id) : null,
  } : null;
}

export async function recordXeroReconciliationActionEvent(
  input: {
    businessId: string;
    issueId: number;
    actorId?: string | number | null;
    actorName?: string | null;
    action: 'retry' | 'authorise';
    reason?: string | null;
    targetType: string;
    referenceId: string | number;
    xeroId?: string | null;
  },
  dependencies: Dependencies = defaultDependencies,
): Promise<void> {
  await dependencies.execute(
    `INSERT INTO xero_reconciliation_issue_events
       (business_id, issue_id, event_type, actor_id, actor_name, reason, snapshot)
     VALUES (?, ?, 'retried', ?, ?, ?, ?)`,
    [
      input.businessId, input.issueId, input.actorId == null ? null : String(input.actorId),
      input.actorName ?? null, input.reason?.trim().slice(0, 1000) || null,
      JSON.stringify({ action: input.action, targetType: input.targetType, referenceId: String(input.referenceId), xeroId: input.xeroId ?? null }),
    ],
  );
}

export async function getXeroReconciliationRecipients(
  businessId: string,
  dependencies: Dependencies = defaultDependencies,
): Promise<string[]> {
  const rows = await dependencies.query<{ recipients_json: string | string[] | null }>(
    `SELECT recipients_json FROM xero_reconciliation_settings WHERE business_id = ? LIMIT 1`,
    [businessId],
  );
  const value = rows[0]?.recipients_json;
  if (!value) return [];
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

export async function saveXeroReconciliationRecipients(
  input: { businessId: string; recipients: string[] },
  dependencies: Dependencies = defaultDependencies,
): Promise<void> {
  await dependencies.execute(
    `INSERT INTO xero_reconciliation_settings (business_id, recipients_json)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE recipients_json = VALUES(recipients_json), updated_at = NOW()`,
    [input.businessId, JSON.stringify(input.recipients)],
  );
}

export type XeroReconciliationEmailSettings = {
  recipients: string[];
  digestFrequency: 'off' | 'daily' | 'weekly';
  digestTimeZone: string;
  digestHour: number;
  digestWeeklyDay: number;
  lastDigestCompletedAt: string | Date | null;
};

export async function getXeroReconciliationEmailSettings(
  businessId: string,
  dependencies: Dependencies = defaultDependencies,
): Promise<XeroReconciliationEmailSettings> {
  const rows = await dependencies.query<any>(
    `SELECT recipients_json, digest_frequency, digest_timezone, digest_hour,
            digest_weekly_day, last_digest_completed_at
       FROM xero_reconciliation_settings WHERE business_id = ? LIMIT 1`,
    [businessId],
  );
  const row = rows[0];
  const rawRecipients = row?.recipients_json;
  const recipients = rawRecipients
    ? (typeof rawRecipients === 'string' ? JSON.parse(rawRecipients) : rawRecipients)
    : [];
  return {
    recipients: Array.isArray(recipients) ? recipients.map(String) : [],
    digestFrequency: ['daily', 'weekly'].includes(row?.digest_frequency) ? row.digest_frequency : 'off',
    digestTimeZone: String(row?.digest_timezone || 'Australia/Sydney'),
    digestHour: Math.max(0, Math.min(23, Number(row?.digest_hour ?? 8))),
    digestWeeklyDay: Math.max(0, Math.min(6, Number(row?.digest_weekly_day ?? 1))),
    lastDigestCompletedAt: row?.last_digest_completed_at ?? null,
  };
}

export async function saveXeroReconciliationEmailSettings(
  input: Omit<XeroReconciliationEmailSettings, 'lastDigestCompletedAt'> & { businessId: string },
  dependencies: Dependencies = defaultDependencies,
): Promise<void> {
  await dependencies.execute(
    `INSERT INTO xero_reconciliation_settings
       (business_id, recipients_json, digest_frequency, digest_timezone, digest_hour, digest_weekly_day)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE recipients_json = VALUES(recipients_json),
       digest_frequency = VALUES(digest_frequency), digest_timezone = VALUES(digest_timezone),
       digest_hour = VALUES(digest_hour), digest_weekly_day = VALUES(digest_weekly_day), updated_at = NOW()`,
    [
      input.businessId, JSON.stringify(input.recipients), input.digestFrequency,
      input.digestTimeZone, input.digestHour, input.digestWeeklyDay,
    ],
  );
}

export type XeroReconciliationEmailIssue = {
  id: number;
  severity: string;
  targetType: string;
  referenceId: string;
  ruleKey: string;
  summary: string;
  amount: number | null;
  recommendedNextStep: string;
  mismatchFingerprint?: string;
};

function mapEmailIssue(row: any): XeroReconciliationEmailIssue {
  const expected = parseJsonObject(row.expected_summary);
  const actual = parseJsonObject(row.actual_summary);
  const amountValue = expected?.total ?? actual?.total ?? null;
  return {
    id: Number(row.id), severity: String(row.severity), targetType: String(row.target_type),
    referenceId: String(row.reference_id), ruleKey: String(row.rule_key), summary: String(row.summary),
    amount: amountValue == null || !Number.isFinite(Number(amountValue)) ? null : Number(amountValue),
    recommendedNextStep: reconciliationRecommendation(String(row.rule_key)),
    mismatchFingerprint: row.mismatch_fingerprint ? String(row.mismatch_fingerprint) : undefined,
  };
}

export async function getXeroReconciliationIssuesForEmail(
  input: { businessId: string; issueIds: number[] },
  dependencies: Dependencies = defaultDependencies,
): Promise<XeroReconciliationEmailIssue[]> {
  const issueIds = Array.from(new Set(input.issueIds)).filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 50);
  if (!issueIds.length) return [];
  const placeholders = issueIds.map(() => '?').join(',');
  const rows = await dependencies.query<any>(
    `SELECT issue.id, issue.severity, issue.rule_key, issue.summary, issue.expected_summary,
            issue.actual_summary, target.target_type, target.reference_id
       FROM xero_reconciliation_issues issue
       JOIN xero_reconciliation_targets target ON target.id = issue.target_id
      WHERE issue.business_id = ? AND issue.status = 'open' AND issue.id IN (${placeholders})`,
    [input.businessId, ...issueIds],
  );
  return rows.map(mapEmailIssue);
}

export async function listOpenXeroReconciliationIssuesForDigest(
  businessId: string,
  dependencies: Dependencies = defaultDependencies,
): Promise<XeroReconciliationEmailIssue[]> {
  const rows = await dependencies.query<any>(
    `SELECT issue.id, issue.severity, issue.rule_key, issue.summary, issue.expected_summary,
            issue.actual_summary, issue.mismatch_fingerprint, target.target_type, target.reference_id
       FROM xero_reconciliation_issues issue
       JOIN xero_reconciliation_targets target ON target.id = issue.target_id
      WHERE issue.business_id = ? AND issue.status = 'open'
      ORDER BY FIELD(issue.severity, 'critical', 'error', 'warning'), issue.first_seen_at, issue.id
      LIMIT 200`,
    [businessId],
  );
  return rows.map(mapEmailIssue);
}

export async function claimXeroReconciliationDelivery(
  input: {
    businessId: string;
    deliveryKey: string;
    payloadFingerprint: string;
    recipients: string[];
    issueIds: number[];
    actorId?: string | number | null;
    actorName?: string | null;
    deliveryType?: 'manual' | 'digest';
  },
  dependencies: Dependencies = defaultDependencies,
): Promise<'claimed' | 'already_sent' | 'in_progress'> {
  const inserted = await dependencies.execute(
    `INSERT IGNORE INTO xero_reconciliation_deliveries
       (business_id, delivery_key, delivery_type, status, payload_fingerprint, recipients_json,
        issue_ids_json, actor_id, actor_name)
     VALUES (?, ?, ?, 'sending', ?, ?, ?, ?, ?)`,
    [
      input.businessId, input.deliveryKey, input.deliveryType ?? 'manual', input.payloadFingerprint,
      JSON.stringify(input.recipients), JSON.stringify(input.issueIds),
      input.actorId == null ? null : String(input.actorId), input.actorName ?? null,
    ],
  );
  if (inserted.affectedRows > 0) return 'claimed';
  const retried = await dependencies.execute(
    `UPDATE xero_reconciliation_deliveries
        SET status = 'sending', error_detail = NULL, attempt_count = attempt_count + 1, attempted_at = NOW()
      WHERE business_id = ? AND delivery_key = ? AND payload_fingerprint = ?
        AND (status = 'failed' OR (status = 'sending' AND attempted_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)))`,
    [input.businessId, input.deliveryKey, input.payloadFingerprint],
  );
  if (retried.affectedRows > 0) return 'claimed';
  const rows = await dependencies.query<{ status: string; payload_fingerprint: string }>(
    `SELECT status, payload_fingerprint FROM xero_reconciliation_deliveries
      WHERE business_id = ? AND delivery_key = ? LIMIT 1`,
    [input.businessId, input.deliveryKey],
  );
  if (rows[0]?.payload_fingerprint !== input.payloadFingerprint) {
    throw new Error('The delivery key was already used for different reconciliation issues.');
  }
  return rows[0]?.status === 'sent' ? 'already_sent' : 'in_progress';
}

export async function markXeroReconciliationDigestCompleted(
  businessId: string,
  dependencies: Dependencies = defaultDependencies,
): Promise<void> {
  await dependencies.execute(
    `UPDATE xero_reconciliation_settings SET last_digest_completed_at = NOW(), updated_at = NOW()
      WHERE business_id = ?`,
    [businessId],
  );
}

export async function completeXeroReconciliationDelivery(
  input: {
    businessId: string;
    deliveryKey: string;
    providerMessageId?: string | null;
  },
  dependencies: Dependencies = defaultDependencies,
): Promise<void> {
  await dependencies.execute(
    `UPDATE xero_reconciliation_deliveries
        SET status = 'sent', provider_message_id = ?, sent_at = NOW(), error_detail = NULL
      WHERE business_id = ? AND delivery_key = ? AND status = 'sending'`,
    [input.providerMessageId ?? null, input.businessId, input.deliveryKey],
  );
}

export async function recordXeroReconciliationEmailEvents(
  input: {
    businessId: string;
    deliveryKey: string;
    issueIds: number[];
    actorId?: string | number | null;
    actorName?: string | null;
    recipients: string[];
  },
  dependencies: Dependencies = defaultDependencies,
): Promise<void> {
  for (const issueId of input.issueIds) {
    await dependencies.execute(
      `INSERT INTO xero_reconciliation_issue_events
         (business_id, issue_id, event_type, actor_id, actor_name, snapshot)
       VALUES (?, ?, 'emailed', ?, ?, ?)`,
      [
        input.businessId, issueId, input.actorId == null ? null : String(input.actorId), input.actorName ?? null,
        JSON.stringify({ deliveryKey: input.deliveryKey, recipients: input.recipients }),
      ],
    );
  }
}

export async function failXeroReconciliationDelivery(
  input: { businessId: string; deliveryKey: string; error: string },
  dependencies: Dependencies = defaultDependencies,
): Promise<void> {
  await dependencies.execute(
    `UPDATE xero_reconciliation_deliveries
        SET status = 'failed', error_detail = ?
      WHERE business_id = ? AND delivery_key = ? AND status = 'sending'`,
    [input.error.slice(0, 500), input.businessId, input.deliveryKey],
  );
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