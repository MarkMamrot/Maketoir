import { Resend } from 'resend';

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

export async function sendWholesaleTeamAccessEmail(input: {
  eventId: number;
  businessId: string;
  email: string;
  name: string;
  companyName: string;
  supplierSlug: string;
  role: 'admin' | 'buyer';
}) {
  if (!process.env.RESEND_API_KEY) return { sent: false as const, reason: 'not_configured' as const };
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const portalUrl = `${baseUrl}/wholesale/${encodeURIComponent(input.supplierSlug)}`;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'Solvantis <onboarding@resend.dev>',
    to: input.email,
    subject: `You have access to ${input.companyName}'s wholesale account`,
    html: `<div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;padding:32px;color:#243129">
      <p>Hi ${escapeHtml(input.name || 'there')},</p>
      <p>You now have ${escapeHtml(input.role)} access to <strong>${escapeHtml(input.companyName)}</strong>'s wholesale account.</p>
      <p style="margin:28px 0"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:12px 18px;background:#267653;color:#fff;text-decoration:none;border-radius:5px;font-weight:700">Open wholesale portal</a></p>
    </div>`,
  }, { idempotencyKey: `wholesale-team-access-${input.businessId}-${input.eventId}` });
  if (error) throw new Error(error.message);
  return { sent: true as const };
}