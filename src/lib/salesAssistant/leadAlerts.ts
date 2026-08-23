import { Resend } from 'resend';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getPool, query } from '@/services/MySQLService';

interface LeadAlertRow {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  preferred_contact: string;
  source_path: string | null;
  conversation_id: string | null;
  fit: string | null;
  requested_integration: string | null;
  requested_provider: string | null;
  alert_sent: number;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

export async function salesLeadAlertRecipients(): Promise<string[]> {
  const configured = String(process.env.SALES_LEAD_RECIPIENTS ?? '').split(',')
    .map(value => value.trim().toLowerCase())
    .filter(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  if (configured.length > 0) return Array.from(new Set(configured));
  const users = await query<{ email: string }>(
    `SELECT email FROM users
      WHERE tier = 'SuperAdmin' AND deleted_at IS NULL AND email IS NOT NULL AND email != ''`,
  );
  return Array.from(new Set(users.map(user => String(user.email).trim().toLowerCase()).filter(Boolean)));
}

export async function deliverProspectLeadAlert(leadId: number): Promise<boolean> {
  if (!Number.isSafeInteger(leadId) || leadId < 1) return false;
  const connection = await getPool().getConnection();
  const lockName = `prospect-lead-alert:${leadId}`;
  let locked = false;
  try {
    const [lockRows] = await connection.execute<Array<{ acquired: number }>>('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
    locked = Number(lockRows[0]?.acquired) === 1;
    if (!locked) return false;
    const [rows] = await connection.execute<LeadAlertRow[]>(
      `SELECT l.id, l.name, l.company, l.email, l.phone, l.preferred_contact, l.source_path,
              l.conversation_id,
              JSON_UNQUOTE(JSON_EXTRACT(m.metadata_json, '$.fit')) AS fit,
              JSON_UNQUOTE(JSON_EXTRACT(m.metadata_json, '$.requestedIntegration')) AS requested_integration,
              JSON_UNQUOTE(JSON_EXTRACT(m.metadata_json, '$.requestedProvider')) AS requested_provider,
              EXISTS(SELECT 1 FROM prospect_lead_events sent
                      WHERE sent.lead_id = l.id AND sent.event_type = 'alert_sent') AS alert_sent
         FROM prospect_leads l
         LEFT JOIN prospect_messages m ON m.id = (
           SELECT pm.id FROM prospect_messages pm
            WHERE pm.conversation_id = l.conversation_id AND pm.role = 'assistant'
            ORDER BY pm.created_at DESC, pm.id DESC LIMIT 1
         )
        WHERE l.id = ? LIMIT 1`,
      [leadId],
    );
    const lead = rows[0];
    if (!lead || Number(lead.alert_sent) === 1) return Boolean(lead);
    const recipients = await salesLeadAlertRecipients();
    if (!process.env.RESEND_API_KEY || recipients.length === 0) throw new Error('Sales lead email delivery is not configured.');
    const appUrl = String(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://solvantis.com.au').replace(/\/$/, '');
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? 'Solvantis <onboarding@resend.dev>',
      to: recipients,
      subject: `New Solvantis sales lead: ${lead.company || lead.name}`.slice(0, 200),
      html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#0f172a">
        <h1 style="font-size:22px">New consented sales lead</h1>
        <p><strong>${escapeHtml(lead.name)}</strong>${lead.company ? ` · ${escapeHtml(lead.company)}` : ''}</p>
        <p>Preferred contact: ${escapeHtml(lead.preferred_contact)}<br>
        Email: ${escapeHtml(lead.email || 'Not provided')}<br>Phone: ${escapeHtml(lead.phone || 'Not provided')}</p>
        <p>Fit: ${escapeHtml(lead.fit || 'Needs discovery')}<br>
        Integration: ${escapeHtml(lead.requested_integration || 'Not specified')}<br>
        Provider: ${escapeHtml(lead.requested_provider || 'Not specified')}<br>
        Source: ${escapeHtml(lead.source_path || 'Not specified')}</p>
        <p>The visitor transcript is available only in the restricted Admin view and is not included in this email.</p>
        <p><a href="${escapeHtml(appUrl)}/admin">Open Prospect Leads</a></p>
      </div>`,
    }, { idempotencyKey: `prospect-lead-alert-${lead.id}` });
    if (error) throw new Error(error.message);
    await connection.execute(
      `INSERT INTO prospect_lead_events (idempotency_key, lead_id, event_type, event_data_json)
       VALUES (?, ?, 'alert_sent', JSON_OBJECT('provider', 'resend'))
       ON DUPLICATE KEY UPDATE id = id`,
      [`lead-alert-sent:${lead.id}`, lead.id],
    );
    return true;
  } catch (error) {
    await connection.execute(
      `INSERT INTO prospect_lead_events (idempotency_key, lead_id, event_type, event_data_json)
       VALUES (?, ?, 'alert_failed', JSON_OBJECT('retryable', TRUE))
       ON DUPLICATE KEY UPDATE created_at = CURRENT_TIMESTAMP(3)`,
      [`lead-alert-failed:${leadId}`, leadId],
    ).catch(() => null);
    await reportRuntimeIssue({
      source: 'ProspectLeadAlerts', operation: 'deliver_alert', severity: 'error',
      title: 'Prospect lead alert delivery failed', error,
      context: { leadId, provider: 'resend', retryable: true },
      reference: { type: 'prospect_lead', id: leadId },
    }).catch(() => null);
    return false;
  } finally {
    if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => null);
    connection.release();
  }
}

export async function retryPendingProspectLeadAlerts(limit = 50): Promise<{ attempted: number; sent: number }> {
  const rows = await query<{ id: number }>(
    `SELECT l.id FROM prospect_leads l
      WHERE EXISTS(SELECT 1 FROM prospect_lead_events p WHERE p.lead_id = l.id AND p.event_type = 'alert_pending')
        AND NOT EXISTS(SELECT 1 FROM prospect_lead_events s WHERE s.lead_id = l.id AND s.event_type = 'alert_sent')
      ORDER BY l.created_at LIMIT ?`,
    [Math.min(Math.max(Math.trunc(limit), 1), 100)],
  );
  let sent = 0;
  for (const row of rows) if (await deliverProspectLeadAlert(Number(row.id))) sent += 1;
  return { attempted: rows.length, sent };
}
