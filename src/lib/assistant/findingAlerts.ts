import { Resend } from 'resend';

import { execute, getPool, query } from '@/services/MySQLService';

interface PendingFinding {
  id: number;
  category: string;
  impact: string;
  title: string;
  capability: string;
  occurrence_count: number;
  affected_business_count: number;
  last_seen_at: string | Date;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

async function recipients(): Promise<string[]> {
  const configured = String(process.env.RUNTIME_ISSUES_ALERT_EMAIL ?? '')
    .split(',').map(value => value.trim().toLowerCase())
    .filter(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  if (configured.length > 0) return Array.from(new Set(configured));
  const users = await query<{ email: string }>(
    `SELECT email FROM users WHERE tier = 'SuperAdmin' AND deleted_at IS NULL AND email IS NOT NULL AND email != ''`,
  );
  return Array.from(new Set(users.map(user => String(user.email).trim().toLowerCase()).filter(Boolean)));
}

export async function deliverPendingWorkflowFindingAlert(findingId: number): Promise<boolean> {
  const connection = await getPool().getConnection().catch(() => null);
  if (!connection) return false;
  let finding: PendingFinding | null = null;
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute(
      `SELECT id, category, impact, title, capability, occurrence_count,
              affected_business_count, last_seen_at
         FROM assistant_workflow_findings
        WHERE id = ? AND alert_pending = 1 LIMIT 1 FOR UPDATE`,
      [findingId],
    );
    finding = rows[0] ?? null;
    if (!finding) {
      await connection.rollback();
      return false;
    }
    await connection.execute(
      `UPDATE assistant_workflow_findings SET alert_pending = 0, last_alerted_at = NOW(3) WHERE id = ?`,
      [findingId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('[assistant-findings] alert claim failed:', error);
    return false;
  } finally {
    connection.release();
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const to = await recipients();
    if (!process.env.RESEND_API_KEY || to.length === 0) throw new Error('Workflow finding email delivery is not configured.');
    const cases = await query<{ public_reference: string }>(
      `SELECT public_reference FROM assistant_escalations
        WHERE workflow_finding_id = ? AND status IN ('open','acknowledged','investigating')
        ORDER BY created_at DESC LIMIT 10`,
      [finding.id],
    );
    const references = cases.map(item => item.public_reference).join(', ') || 'No linked case reference';
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? 'Solvantis <onboarding@resend.dev>',
      to,
      subject: `[${finding.impact.toUpperCase()}] Candidate workflow finding: ${finding.title}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#0f172a;">
        <h1 style="font-size:22px;">Candidate workflow finding pending triage</h1>
        <p>This is not yet a confirmed defect or missing feature.</p>
        <p><strong>${escapeHtml(finding.capability)}</strong> · ${escapeHtml(finding.category)}</p>
        <h2 style="font-size:17px;">${escapeHtml(finding.title)}</h2>
        <p>Occurrences: <strong>${finding.occurrence_count}</strong> · Affected businesses: <strong>${finding.affected_business_count}</strong></p>
        <p>Cases: ${escapeHtml(references)}</p>
        <p><a href="${escapeHtml(process.env.APP_URL ?? 'https://solvantis.com.au')}/admin">Open developer triage</a></p>
      </div>`,
    }, { idempotencyKey: `workflow-finding-alert-${finding.id}-${new Date(finding.last_seen_at).getTime()}` });
    if (error) throw new Error(error.message);
    return true;
  } catch (error) {
    await execute(
      `UPDATE assistant_workflow_findings SET alert_pending = 1, last_alerted_at = NULL WHERE id = ?`,
      [finding.id],
    ).catch(() => {});
    console.error('[assistant-findings] alert email failed:', error);
    return false;
  }
}