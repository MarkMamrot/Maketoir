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

export async function sendRuntimeIssuesDailyDigest(now = new Date()): Promise<{ sent: boolean; issueCount: number }> {
  const issues = await query<AlertIssue>(
    `SELECT ri.id, COALESCE(b.name, 'System') AS business_name, ri.source, ri.operation,
            ri.severity, ri.title, ri.message, ri.occurrence_count, ri.last_seen_at
       FROM runtime_issues ri
       LEFT JOIN businesses b ON b.business_id = ri.business_id
      WHERE ri.status IN ('new', 'in_progress')
      ORDER BY FIELD(ri.severity, 'critical', 'error', 'warning'), ri.last_seen_at DESC
      LIMIT 200`,
  );
  if (issues.length === 0) return { sent: false, issueCount: 0 };

  const recipients = await getRecipients();
  const rows = issues.map(issue => `<tr>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(issue.severity)}</td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(issue.business_name)}</td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;"><strong>${escapeHtml(issue.title)}</strong><br><small>${escapeHtml(issue.source)} / ${escapeHtml(issue.operation)}</small></td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${issue.occurrence_count}</td>
  </tr>`).join('');
  const date = now.toISOString().slice(0, 10);
  await sendEmail({
    recipients,
    subject: `Solvantis Runtime Issues digest — ${issues.length} unresolved`,
    idempotencyKey: `runtime-issues-digest-${date}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;color:#0f172a;">
      <h1 style="font-size:22px;">Runtime Issues daily digest</h1>
      <p>${issues.length} unresolved issue${issues.length === 1 ? '' : 's'} require review.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th>Severity</th><th>Organisation</th><th>Issue</th><th>Count</th></tr></thead><tbody>${rows}</tbody></table>
      <p><a href="${escapeHtml(process.env.APP_URL ?? 'https://solvantis.com.au')}/admin">Open Runtime Issues</a></p>
    </div>`,
  });
  return { sent: true, issueCount: issues.length };
}