import { Resend } from 'resend';

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

function currency(value: number) {
  return Number(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

export async function sendWholesaleOrderSubmittedReceipt(input: {
  businessId: string;
  salesOrderId: number;
  salesOrderNumber: string;
  supplierName: string;
  supplierSlug: string;
  buyerEmail: string;
  buyerName: string;
  companyName: string;
  total: number;
  items: Array<{ product_name: string; variant_label?: string | null; sku?: string | null; qty: number; line_total: number; is_indent?: boolean }>;
}) {
  if (!process.env.RESEND_API_KEY) return { sent: false as const, reason: 'not_configured' as const };
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const ordersUrl = `${appUrl}/wholesale/${encodeURIComponent(input.supplierSlug)}/orders`;
  const rows = input.items.map(item => `<tr>
    <td style="padding:9px 0;border-bottom:1px solid #e5e9e6">${escapeHtml(item.product_name)}${item.variant_label ? ` <span style="color:#6b766f">${escapeHtml(item.variant_label)}</span>` : ''}</td>
    <td style="padding:9px 8px;border-bottom:1px solid #e5e9e6;color:#6b766f">${escapeHtml(item.sku || '—')}</td>
    <td style="padding:9px 8px;border-bottom:1px solid #e5e9e6;text-align:right">${Number(item.qty)}${item.is_indent ? ' (indent)' : ''}</td>
    <td style="padding:9px 0;border-bottom:1px solid #e5e9e6;text-align:right">${currency(item.line_total)}</td>
  </tr>`).join('');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'Solvantis <onboarding@resend.dev>',
    to: input.buyerEmail,
    subject: `${input.supplierName} received your wholesale order ${input.salesOrderNumber}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:32px;color:#243129">
      <p style="margin:0 0 8px;color:#267653;font-size:12px;font-weight:700;text-transform:uppercase">Order received</p>
      <h1 style="margin:0 0 18px;font-size:24px">${escapeHtml(input.salesOrderNumber)}</h1>
      <p>Hi ${escapeHtml(input.buyerName || input.companyName)},</p>
      <p>${escapeHtml(input.supplierName)} has received your order for ${escapeHtml(input.companyName)}.</p>
      <table style="width:100%;border-collapse:collapse;margin:22px 0;font-size:13px"><tbody>${rows}</tbody></table>
      <p style="text-align:right;font-size:17px"><strong>Total ${currency(input.total)}</strong></p>
      <p style="margin:28px 0"><a href="${escapeHtml(ordersUrl)}" style="display:inline-block;padding:12px 18px;background:#267653;color:#fff;text-decoration:none;border-radius:5px;font-weight:700">View order</a></p>
      <p style="color:#6b766f;font-size:12px">This confirms receipt only. ${escapeHtml(input.supplierName)} will update the order as it is processed.</p>
    </div>`,
  }, { idempotencyKey: `wholesale-order-submitted-${input.businessId}-${input.salesOrderId}` });
  if (error) throw new Error(error.message);
  return { sent: true as const };
}