import { Resend } from 'resend';

export type ReconciliationEmailIssue = {
  id: number;
  severity: string;
  reference: string;
  documentType: string;
  discrepancy: string;
  summary: string;
  amount: number | null;
  recommendedNextStep: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

export function parseReconciliationRecipients(value: unknown): { recipients: string[]; invalid: string[] } {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;\n]/) : [];
  const normalized = values.map(item => String(item).trim().toLowerCase()).filter(Boolean);
  return {
    recipients: Array.from(new Set(normalized.filter(item => EMAIL_PATTERN.test(item)))),
    invalid: Array.from(new Set(normalized.filter(item => !EMAIL_PATTERN.test(item)))),
  };
}

export function renderReconciliationEmail(input: {
  businessName: string;
  actorName: string;
  issues: ReconciliationEmailIssue[];
  appUrl: string;
}): { subject: string; html: string } {
  const rows = input.issues.map(issue => `<tr>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(issue.severity)}</td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;"><strong>${escapeHtml(issue.reference)}</strong><br><small>${escapeHtml(issue.documentType)}</small></td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;"><strong>${escapeHtml(issue.discrepancy)}</strong><br>${escapeHtml(issue.summary)}</td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${issue.amount == null ? '—' : escapeHtml(issue.amount.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' }))}</td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(issue.recommendedNextStep)}</td>
  </tr>`).join('');
  const appUrl = input.appUrl.replace(/\/$/, '');
  return {
    subject: `${input.businessName}: ${input.issues.length} Xero reconciliation issue${input.issues.length === 1 ? '' : 's'}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:820px;margin:0 auto;color:#0f172a;">
      <h1 style="font-size:22px;">Xero reconciliation requires review</h1>
      <p><strong>${escapeHtml(input.businessName)}</strong> sent ${input.issues.length} issue${input.issues.length === 1 ? '' : 's'} for accounts review. Sent by ${escapeHtml(input.actorName)}.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th>Severity</th><th>Reference</th><th>Issue</th><th>Amount</th><th>Next step</th></tr></thead><tbody>${rows}</tbody></table>
      <p><a href="${escapeHtml(appUrl)}/ims#xero/sync">Open Xero reconciliation in Solvantis</a></p>
    </div>`,
  };
}

export async function sendReconciliationEmail(input: {
  recipients: string[];
  subject: string;
  html: string;
  idempotencyKey: string;
}): Promise<string | null> {
  if (!process.env.RESEND_API_KEY) throw new Error('Reconciliation email delivery is not configured.');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'Solvantis <onboarding@resend.dev>',
    to: input.recipients,
    subject: input.subject,
    html: input.html,
  }, { idempotencyKey: input.idempotencyKey });
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}