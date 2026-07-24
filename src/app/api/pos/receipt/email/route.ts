import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Resend } from 'resend';

function getPosSession() {
  const pos = cookies().get('pos_session')?.value;
  const adm = cookies().get('marketoir_session')?.value;
  if (pos) try { return JSON.parse(pos); } catch {}
  if (adm) try { return JSON.parse(adm); } catch {}
  return null;
}

function fmt(n: number) { return n.toFixed(2); }

/**
 * POST /api/pos/receipt/email
 * Body: { email, sale, printSettings }
 * Sends an HTML receipt email via Resend.
 */
export async function POST(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorised.' }, { status: 401 });

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ success: false, error: 'Email sending is not configured (RESEND_API_KEY missing).' }, { status: 503 });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const { email, sale, printSettings } = body ?? {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ success: false, error: 'A valid email address is required.' }, { status: 400 });
  }
  if (!sale || !sale.items) {
    return NextResponse.json({ success: false, error: 'Sale data is required.' }, { status: 400 });
  }

  const sanitiseEmail = email.toLowerCase().trim();

  // ── Build receipt HTML ────────────────────────────────────────────────────
  const businessName   = printSettings?.business_name ?? '';
  const businessAddr   = printSettings?.business_address ?? (sale.location_name ?? '');
  const businessAbn    = printSettings?.business_abn ?? '';
  const businessPhone  = printSettings?.business_phone ?? '';
  const logoUrl        = printSettings?.receipt_logo_url ?? '';
  const footerText     = printSettings?.pos_receipt_footer ?? 'Thank you for your purchase!';

  const saleDate = new Date(sale.created_at).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' });
  const saleRef  = sale.id ? `#${sale.id}` : `local:${(sale.local_id ?? '').slice(-8)}`;
  const changeDue = body.changeDue ?? 0;
  const total     = (sale.total ?? 0) + (sale.cash_rounding ?? 0);

  const itemRows = (sale.items ?? []).map((i: any) => {
    const isOnSale = i.original_price != null && i.original_price !== i.unit_price;
    const origAmt  = isOnSale ? fmt((i.original_price ?? 0) * Math.abs(i.qty ?? 1)) : '';
    return `
    <tr>
      <td style="padding:4px 0;font-size:13px;">${i.qty}&times; ${i.name ?? ''}</td>
      <td style="padding:4px 0;font-size:13px;text-align:right;white-space:nowrap;">
        ${isOnSale ? `<span style="text-decoration:line-through;color:#9ca3af;margin-right:5px;font-size:11px;">$${origAmt}</span>` : ''}
        <span style="${isOnSale ? 'color:#d97706;font-weight:700;' : ''}">$${fmt(i.line_total ?? 0)}</span>
      </td>
    </tr>`;
  }).join('');

  const paymentRows = (sale.payments ?? []).map((p: any) => `
    <tr>
      <td style="padding:3px 0;font-size:13px;color:#555;">${p.method ?? ''}</td>
      <td style="padding:3px 0;font-size:13px;text-align:right;color:#555;">$${fmt(p.amount ?? 0)}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" width="400" style="background:#ffffff;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.08);overflow:hidden;max-width:100%;">

        <!-- Header -->
        <tr><td style="padding:24px 28px 16px;text-align:center;border-bottom:1px dashed #d1d5db;">
          ${logoUrl ? `<img src="${logoUrl}" alt="" style="max-width:160px;max-height:70px;object-fit:contain;display:block;margin:0 auto 12px;" />` : ''}
          ${businessName ? `<div style="font-size:18px;font-weight:700;color:#111;">${businessName}</div>` : ''}
          ${businessAddr ? `<div style="font-size:12px;color:#6b7280;margin-top:3px;">${businessAddr}</div>` : ''}
          ${businessPhone ? `<div style="font-size:12px;color:#6b7280;">${businessPhone}</div>` : ''}
          ${businessAbn ? `<div style="font-size:12px;color:#6b7280;">ABN: ${businessAbn}</div>` : ''}
          <div style="font-size:12px;color:#9ca3af;margin-top:8px;">${saleDate} · Served by ${sale.cashier_name ?? ''}</div>
          ${sale.customer_name ? `<div style="font-size:13px;font-weight:600;color:#374151;margin-top:4px;">${sale.customer_name}</div>` : ''}
          <div style="font-size:11px;color:#9ca3af;margin-top:4px;">${saleRef} — ${(sale.sale_type ?? 'SALE').toUpperCase()}</div>
        </td></tr>

        <!-- Items -->
        <tr><td style="padding:16px 28px;">
          <table cellpadding="0" cellspacing="0" width="100%">
            ${itemRows}
          </table>
        </td></tr>

        <!-- Totals -->
        <tr><td style="padding:0 28px 16px;border-top:1px dashed #d1d5db;">
          <table cellpadding="0" cellspacing="0" width="100%" style="margin-top:12px;">
            ${(sale.discount_total ?? 0) > 0 ? `
            <tr>
              <td style="padding:3px 0;font-size:13px;color:#9ca3af;">Discount</td>
              <td style="padding:3px 0;font-size:13px;text-align:right;color:#9ca3af;">-$${fmt(sale.discount_total)}</td>
            </tr>` : ''}
            ${(sale.cash_rounding ?? 0) !== 0 ? `
            <tr>
              <td style="padding:3px 0;font-size:13px;color:#9ca3af;">Cash Rounding</td>
              <td style="padding:3px 0;font-size:13px;text-align:right;color:#9ca3af;">${(sale.cash_rounding ?? 0) >= 0 ? '+' : ''}${fmt(sale.cash_rounding ?? 0)}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:3px 0;font-size:12px;color:#9ca3af;">GST included</td>
              <td style="padding:3px 0;font-size:12px;text-align:right;color:#9ca3af;">$${fmt(sale.tax_total ?? 0)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0 4px;font-size:15px;font-weight:700;color:#111;border-top:1px solid #e5e7eb;">TOTAL</td>
              <td style="padding:8px 0 4px;font-size:15px;font-weight:700;text-align:right;color:#111;border-top:1px solid #e5e7eb;">$${fmt(total)}</td>
            </tr>
          </table>
        </td></tr>

        <!-- Payments -->
        <tr><td style="padding:0 28px 16px;border-top:1px dashed #d1d5db;">
          <table cellpadding="0" cellspacing="0" width="100%" style="margin-top:12px;">
            ${paymentRows}
            ${changeDue > 0.004 ? `
            <tr>
              <td style="padding:3px 0;font-size:13px;color:#555;border-top:1px dashed #d1d5db;">Tendered</td>
              <td style="padding:3px 0;font-size:13px;text-align:right;color:#555;border-top:1px dashed #d1d5db;">$${fmt(total + changeDue)}</td>
            </tr>
            <tr>
              <td style="padding:3px 0;font-size:13px;font-weight:600;color:#111;">Change</td>
              <td style="padding:3px 0;font-size:13px;font-weight:600;text-align:right;color:#111;">$${fmt(changeDue)}</td>
            </tr>` : ''}
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 28px 24px;text-align:center;border-top:1px dashed #d1d5db;background:#f9fafb;">
          <div style="font-size:12px;color:#9ca3af;white-space:pre-wrap;">${footerText}</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  if (!process.env.RESEND_FROM_EMAIL) {
    console.warn('Receipt email: RESEND_FROM_EMAIL is not set. Emails will be sent from onboarding@resend.dev which only works for the Resend account owner\'s email address.');
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM_EMAIL ?? 'Solvantis POS <onboarding@resend.dev>';
    const subject = businessName
      ? `Your receipt from ${businessName}`
      : 'Your receipt';

    const { data, error } = await resend.emails.send({ from, to: sanitiseEmail, subject, html });
    if (error) {
      console.error('Receipt email Resend error:', error);
      return NextResponse.json({ success: false, error: error.message ?? 'Failed to send email.' }, { status: 500 });
    }
    console.log('Receipt email sent:', data?.id, '→', sanitiseEmail);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Receipt email error:', err);
    return NextResponse.json({ success: false, error: err.message ?? 'Failed to send email.' }, { status: 500 });
  }
}
