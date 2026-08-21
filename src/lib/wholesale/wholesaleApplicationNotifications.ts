import { Resend } from 'resend';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

export async function sendWholesaleApplicationDecision(input: {
  applicationId: number;
  email: string;
  contactName: string;
  supplierName: string;
  supplierSlug: string;
  decision: 'approved' | 'rejected';
  reason?: string;
}) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');
  const approved = input.decision === 'approved';
  const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/wholesale/${encodeURIComponent(input.supplierSlug)}`;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: 'Solvantis <onboarding@resend.dev>',
    to: input.email,
    subject: approved
      ? `Your ${input.supplierName} wholesale account is ready`
      : `Update on your ${input.supplierName} wholesale application`,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#17202a">
      <p>Hi ${escapeHtml(input.contactName)},</p>
      <p>${approved
        ? `${escapeHtml(input.supplierName)} has approved your wholesale account.`
        : `${escapeHtml(input.supplierName)} has reviewed your wholesale application.`}</p>
      ${approved
        ? `<p style="margin:28px 0"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:12px 20px;background:#163f34;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Open wholesale portal</a></p>`
        : `<p>${escapeHtml(input.reason || 'Please contact the supplier if you would like more information.')}</p>`}
    </div>`,
  }, { idempotencyKey: `wholesale-application-${input.applicationId}-${input.decision}` });
  if (error) throw new Error(error.message);
}