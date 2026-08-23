import { Resend } from 'resend';

import { execute, getPool, query } from '@/services/MySQLService';

interface AlertIssue {
  id: number;
  business_name: string;
  source: string;
  operation: string;
  severity: string;
  title: string;
  message: string;
  occurrence_count: number;
  last_seen_at: string | Date;
}

interface DigestWorkflowFinding {
  id: number;
  category: string;
  impact: string;
  capability: string;
  title: string;
  occurrence_count: number;
  affected_business_count: number;
}

interface DigestEscalation {
  public_reference: string;
  business_name: string;
  audience: string;
  status: string;
  response_due_at: string | Date;
  parent_kind: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

async function getRecipients(): Promise<string[]> {
  const configured = String(process.env.RUNTIME_ISSUES_ALERT_EMAIL ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  if (configured.length > 0) return Array.from(new Set(configured));
  const users = await query<{ email: string }>(
    `SELECT email FROM users
      WHERE tier = 'SuperAdmin' AND deleted_at IS NULL AND email IS NOT NULL AND email != ''`,
  );
  return Array.from(new Set(users.map(user => String(user.email).trim().toLowerCase()).filter(Boolean)));
}

async function sendEmail(input: { recipients: string[]; subject: string; html: string; idempotencyKey: string }) {
  if (!process.env.RESEND_API_KEY || input.recipients.length === 0) {
    throw new Error('Runtime issue email delivery is not configured.');
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'Solvantis <onboarding@resend.dev>',
    to: input.recipients,
    subject: input.subject,
    html: input.html,
  }, { idempotencyKey: input.idempotencyKey });
  if (error) throw new Error(error.message);
}

export async function deliverPendingRuntimeIssueAlert(issueId: number): Promise<boolean> {
  const connection = await getPool().getConnection().catch(error => {
    console.error('[runtime-issues] alert claim connection failed:', error);
    return null;
  });
  if (!connection) return false;

  let issue: AlertIssue | null = null;
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute(
      `SELECT ri.id, COALESCE(b.name, 'System') AS business_name, ri.source, ri.operation,
              ri.severity, ri.title, ri.message, ri.occurrence_count, ri.last_seen_at
         FROM runtime_issues ri
         LEFT JOIN businesses b ON b.business_id = ri.business_id
        WHERE ri.id = ? AND ri.alert_pending = 1
        LIMIT 1 FOR UPDATE`,
      [issueId],
    );
    issue = rows[0] ?? null;
    if (!issue) {
      await connection.rollback();
      return false;
    }
    await connection.execute(
      `UPDATE runtime_issues SET alert_pending = 0, last_alerted_at = NOW(3) WHERE id = ?`,
      [issueId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('[runtime-issues] alert claim failed:', error);
    return false;
  } finally {
    connection.release();
  }

  try {
    const recipients = await getRecipients();
    await sendEmail({
      recipients,
      subject: `[${issue.severity.toUpperCase()}] Runtime issue: ${issue.title}`,
      idempotencyKey: `runtime-issue-alert-${issue.id}-${new Date(issue.last_seen_at).getTime()}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#0f172a;">
        <h1 style="font-size:22px;">Runtime issue requires review</h1>
        <p><strong>${escapeHtml(issue.business_name)}</strong> · ${escapeHtml(issue.source)} / ${escapeHtml(issue.operation)}</p>
        <h2 style="font-size:17px;">${escapeHtml(issue.title)}</h2>
        <p>${escapeHtml(issue.message)}</p>
        <p>Occurrences: <strong>${issue.occurrence_count}</strong></p>
        <p><a href="${escapeHtml(process.env.APP_URL ?? 'https://solvantis.com.au')}/admin">Open Runtime Issues</a></p>
      </div>`,
    });
    return true;
  } catch (error) {
    await execute(
      `UPDATE runtime_issues SET alert_pending = 1, last_alerted_at = NULL WHERE id = ?`,
      [issue.id],
    ).catch(() => {});
    console.error('[runtime-issues] alert email failed:', error);
    return false;
  }
}

export async function retryPendingRuntimeIssueAlerts(limit = 50): Promise<{ attempted: number; sent: number }> {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
  const pending = await query<{ id: number }>(
    `SELECT id
       FROM runtime_issues
      WHERE alert_pending = 1
      ORDER BY FIELD(severity, 'critical', 'error', 'warning'), last_seen_at
      LIMIT ${boundedLimit}`,
  );
  let sent = 0;
  for (const issue of pending) {
    if (await deliverPendingRuntimeIssueAlert(Number(issue.id))) sent += 1;
  }
  return { attempted: pending.length, sent };
}

export async function sendRuntimeIssuesDailyDigest(now = new Date()): Promise<{
  sent: boolean;
  issueCount: number;
  findingCount: number;
  dueCaseCount: number;
}> {
  const [issues, findings, dueCases] = await Promise.all([
    query<AlertIssue>(
      `SELECT ri.id, COALESCE(b.name, 'System') AS business_name, ri.source, ri.operation,
              ri.severity, ri.title, ri.message, ri.occurrence_count, ri.last_seen_at
         FROM runtime_issues ri
         LEFT JOIN businesses b ON b.business_id = ri.business_id
        WHERE ri.status IN ('new', 'in_progress')
        ORDER BY FIELD(ri.severity, 'critical', 'error', 'warning'), ri.last_seen_at DESC
        LIMIT 200`,
    ),
    query<DigestWorkflowFinding>(
      `SELECT id, category, impact, capability, title, occurrence_count, affected_business_count
         FROM assistant_workflow_findings
        WHERE status IN ('new', 'triaging', 'confirmed_defect', 'confirmed_gap', 'planned')
        ORDER BY FIELD(impact, 'critical', 'high', 'medium', 'low'), last_seen_at DESC
        LIMIT 100`,
    ).catch(() => []),
    query<DigestEscalation>(
      `SELECT ae.public_reference, COALESCE(b.name, ae.business_id) AS business_name,
              ae.audience, ae.status, ae.response_due_at, ae.parent_kind
         FROM assistant_escalations ae
         LEFT JOIN businesses b ON b.business_id = ae.business_id
        WHERE ae.status IN ('open', 'acknowledged', 'investigating')
          AND ae.response_due_at <= DATE_ADD(?, INTERVAL 1 DAY)
        ORDER BY ae.response_due_at, ae.id
        LIMIT 100`,
      [now],
    ).catch(() => []),
  ]);
  if (issues.length === 0 && findings.length === 0 && dueCases.length === 0) {
    return { sent: false, issueCount: 0, findingCount: 0, dueCaseCount: 0 };
  }

  const recipients = await getRecipients();
  const issueRows = issues.map(issue => `<tr>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(issue.severity)}</td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(issue.business_name)}</td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;"><strong>${escapeHtml(issue.title)}</strong><br><small>${escapeHtml(issue.source)} / ${escapeHtml(issue.operation)}</small></td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${issue.occurrence_count}</td>
  </tr>`).join('');
  const findingRows = findings.map(finding => `<tr>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(finding.impact)}</td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(finding.capability)}</td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;"><strong>${escapeHtml(finding.title)}</strong><br><small>${escapeHtml(finding.category)}</small></td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${finding.occurrence_count} / ${finding.affected_business_count}</td>
  </tr>`).join('');
  const dueCaseRows = dueCases.map(escalation => `<tr>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;"><strong>${escapeHtml(escalation.public_reference)}</strong></td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(escalation.business_name)}</td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(escalation.audience)} / ${escapeHtml(escalation.parent_kind)}</td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(new Date(escalation.response_due_at).toISOString().slice(0, 10))}</td>
  </tr>`).join('');
  const date = now.toISOString().slice(0, 10);
  await sendEmail({
    recipients,
    subject: `Solvantis daily review: ${issues.length} issues, ${findings.length} findings, ${dueCases.length} cases due`,
    idempotencyKey: `runtime-issues-digest-${date}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;color:#0f172a;">
      <h1 style="font-size:22px;">Solvantis daily review</h1>
      ${issues.length ? `<h2 style="font-size:17px;">Runtime issues</h2><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th>Severity</th><th>Organisation</th><th>Issue</th><th>Count</th></tr></thead><tbody>${issueRows}</tbody></table>` : ''}
      ${findings.length ? `<h2 style="font-size:17px;margin-top:24px;">Workflow findings</h2><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th>Impact</th><th>Capability</th><th>Candidate finding</th><th>Occurrences / businesses</th></tr></thead><tbody>${findingRows}</tbody></table>` : ''}
      ${dueCases.length ? `<h2 style="font-size:17px;margin-top:24px;">User cases due within one day</h2><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th>Reference</th><th>Organisation</th><th>Audience / type</th><th>Due</th></tr></thead><tbody>${dueCaseRows}</tbody></table>` : ''}
      <p><a href="${escapeHtml(process.env.APP_URL ?? 'https://solvantis.com.au')}/admin">Open admin review</a></p>
    </div>`,
  });
  return { sent: true, issueCount: issues.length, findingCount: findings.length, dueCaseCount: dueCases.length };
}