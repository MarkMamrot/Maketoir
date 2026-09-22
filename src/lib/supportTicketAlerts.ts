import { Resend } from 'resend';

import { getSupportTicketNotificationEmail } from '@/lib/supportTickets';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

interface NewTicketAlertInput {
  id: number;
  businessName: string;
  sourceApp: 'ims' | 'pos';
  screenContext: string | null;
  submittedByName: string | null;
  submittedByEmail: string | null;
  subject: string;
  description: string;
}

/** Best-effort notification only — never throws; callers should not fail ticket creation on email errors. */
export async function sendNewSupportTicketAlert(ticket: NewTicketAlertInput): Promise<void> {
  const recipient = await getSupportTicketNotificationEmail();
  if (!recipient || !process.env.RESEND_API_KEY) return;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'Solvantis <onboarding@resend.dev>',
    to: [recipient],
    subject: `New support ticket: ${ticket.subject}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#0f172a;">
      <h1 style="font-size:22px;">New support ticket</h1>
      <p><strong>${escapeHtml(ticket.businessName)}</strong> · ${escapeHtml(ticket.sourceApp.toUpperCase())}${ticket.screenContext ? ` · ${escapeHtml(ticket.screenContext)}` : ''}</p>
      <p>From: ${escapeHtml(ticket.submittedByName ?? 'Unknown')}${ticket.submittedByEmail ? ` (${escapeHtml(ticket.submittedByEmail)})` : ''}</p>
      <h2 style="font-size:17px;">${escapeHtml(ticket.subject)}</h2>
      <p style="white-space:pre-wrap;">${escapeHtml(ticket.description)}</p>
      <p><a href="${escapeHtml(process.env.APP_URL ?? 'https://solvantis.com.au')}/admin">Open Support Tickets</a></p>
    </div>`,
  }, { idempotencyKey: `support-ticket-created-${ticket.id}` });
  if (error) throw new Error(error.message);
}
