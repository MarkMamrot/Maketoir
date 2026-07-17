/**
 * POST /api/wholesale/orders/[id]/submit
 *
 * Submits a wholesale draft order:
 *   1. Marks wholesale_draft_orders.status = 'submitted'
 *   2. Creates a Draft Sales Order in ims_sales_orders (linked back)
 *   3. Creates an ims_notifications entry for the business
 *   4. Sends notification email to wholesale_notification_email setting (if configured)
 */
import { NextResponse } from 'next/server';
import { requireWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { enterImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { createNotification } from '@/lib/ims/createNotification';
import { Resend } from 'resend';

type Ctx = { params: { id: string } };

const fmtCurrency = (n: number) =>
  `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const todayIso = () => new Date().toISOString().slice(0, 10);

export async function POST(_req: Request, { params }: Ctx) {
  const { session, response } = requireWholesaleSession();
  if (response) return response;
  await enterImsForBusiness(session.businessId);

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    // ── 1. Fetch draft order + items ─────────────────────────────────────────
    const orderRows = await imsQuery<any>(
      `SELECT * FROM wholesale_draft_orders WHERE id = ? AND business_id = ? AND contact_id = ?`,
      [id, session.businessId, session.contactId],
    );
    const order = orderRows[0];
    if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    if (order.status !== 'draft') {
      return NextResponse.json({ error: 'Only draft orders can be submitted.' }, { status: 400 });
    }

    const items = await imsQuery<any>(
      `SELECT * FROM wholesale_draft_order_items WHERE order_id = ? ORDER BY id`,
      [id],
    );

    // Guard: cannot submit an empty order
    if (items.length === 0) {
      return NextResponse.json({ error: 'Cannot submit an empty order.' }, { status: 400 });
    }

    // ── Server-side stock validation for non-indent items ────────────────────
    const nonIndentItems = items.filter((i: any) => !i.is_indent);
    if (nonIndentItems.length > 0) {
      const stockPlaceholders = nonIndentItems.map(() => '?').join(',');
      const stockRows = await imsQuery<{ variant_id: string; available: number }>(
        `SELECT variant_id,
                GREATEST(0, SUM(qty_on_hand) - SUM(COALESCE(qty_committed,0))) AS available
         FROM ims_stock
         WHERE variant_id IN (${stockPlaceholders})
         GROUP BY variant_id`,
        nonIndentItems.map((i: any) => i.variant_id),
      );
      const liveStock: Record<string, number> = {};
      for (const r of stockRows) liveStock[r.variant_id] = Number(r.available);

      const overstock = nonIndentItems
        .filter((i: any) => i.qty > (liveStock[i.variant_id] ?? 0))
        .map((i: any) => ({
          product_name:  i.product_name,
          variant_label: i.variant_label ?? null,
          qty_requested: i.qty,
          qty_available: liveStock[i.variant_id] ?? 0,
        }));

      if (overstock.length > 0) {
        return NextResponse.json(
          { error: 'Some items exceed available stock. Please update your order and try again.', overstock },
          { status: 409 },
        );
      }
    }

    // ── 2. Get IMS settings ──────────────────────────────────────────────────
    const settingRows = await imsQuery<{ key: string; value: string }>(
      `SELECT \`key\`, value FROM ims_settings WHERE business_id = ?`,
      [session.businessId],
    );
    const settings: Record<string, string> = {};
    for (const r of settingRows) settings[r.key] = r.value;

    // Resolve location_id for the Sales Order (default warehouse, else first active location)
    let locationId = settings.default_warehouse_location_id
      ? parseInt(settings.default_warehouse_location_id, 10)
      : 0;

    if (!locationId) {
      const locs = await imsQuery<{ id: number }>(
        `SELECT id FROM ims_locations WHERE business_id = ? AND is_active = 1 ORDER BY id ASC LIMIT 1`,
        [session.businessId],
      );
      locationId = locs[0]?.id ?? 1;
    }

    const taxRate   = parseFloat(settings.sales_tax_rate ?? '0') || 0;
    const notifyEmail = (settings.wholesale_notification_email ?? '').trim();

    // ── 3. Create Draft Sales Order ──────────────────────────────────────────
    const soItems = items.map((item: any) => ({
      variant_id:  item.variant_id,
      qty_ordered: item.qty,
      unit_price:  Number(item.unit_price),
      discount_pct: 0,
      tax_rate:    taxRate,
      line_total:  Number(item.line_total),
      notes:       item.is_indent ? 'Indent order' : undefined,
    }));

    const soNotes = [
      `Wholesale Portal order #${id} submitted by ${session.name || session.email}${session.company ? ` (${session.company})` : ''}.`,
      order.notes ? `Customer notes: ${order.notes}` : '',
    ].filter(Boolean).join('\n');

    const soId = await ImsSORepo.create(
      {
        so_number:    '',       // auto-generated
        customer_id:  session.contactId,
        location_id:  locationId,
        status:       'draft',
        order_date:   todayIso(),
        notes:        soNotes,
        subtotal:     Number(order.subtotal),
        tax_amount:   0,
        total_amount: Number(order.total_amount),
      },
      soItems,
      session.businessId,
    );

    // ── 4. Mark wholesale draft order as submitted ───────────────────────────
    await imsExecute(
      `UPDATE wholesale_draft_orders
          SET status = 'submitted', submitted_at = NOW(), so_id = ?
        WHERE id = ?`,
      [soId, id],
    );

    // ── 5. Get SO number for display ─────────────────────────────────────────
    const soRows = await imsQuery<{ so_number: string }>(
      `SELECT so_number FROM ims_sales_orders WHERE id = ?`, [soId],
    );
    const soNumber = soRows[0]?.so_number ?? `SO-${soId}`;

    // ── 6. In-app notification ────────────────────────────────────────────────
    createNotification(
      session.businessId,
      'wholesale_order',
      `New Wholesale Order — ${soNumber}`,
      `${session.name || session.email}${session.company ? ` (${session.company})` : ''} submitted wholesale order #${id}. Draft SO ${soNumber} created.`,
      { wholesale_order_id: id, so_id: soId, so_number: soNumber, contact_id: session.contactId },
      'info',
    ).catch(err => console.error('[wholesale/submit] notification failed:', err));

    // ── 7. Email notification ─────────────────────────────────────────────────
    if (notifyEmail && process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const from   = process.env.RESEND_FROM_EMAIL ?? 'Solvantis <onboarding@resend.dev>';

      const itemRows = items.map((item: any) => `
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:8px 10px;font-size:13px;color:#0f172a;">${item.product_name}${item.variant_label ? ` — ${item.variant_label}` : ''}</td>
          <td style="padding:8px 10px;font-size:13px;color:#475569;white-space:nowrap;">${item.sku ?? '—'}</td>
          <td style="padding:8px 10px;font-size:13px;color:#475569;text-align:center;">${item.qty}${item.is_indent ? ' <span style="color:#f59e0b;font-size:11px;font-weight:700;">INDENT</span>' : ''}</td>
          <td style="padding:8px 10px;font-size:13px;color:#475569;text-align:right;white-space:nowrap;">${fmtCurrency(Number(item.unit_price))}</td>
          <td style="padding:8px 10px;font-size:13px;font-weight:600;color:#0f172a;text-align:right;white-space:nowrap;">${fmtCurrency(Number(item.line_total))}</td>
        </tr>`).join('');

      const hasIndent = items.some((i: any) => i.is_indent);

      resend.emails.send({
        from,
        to: notifyEmail,
        subject: `New Wholesale Order — ${soNumber} from ${session.name || session.email}`,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:620px;margin:0 auto;padding:32px;background:#fff;border-radius:12px;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
              <div style="width:38px;height:38px;background:#2563eb;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg width="20" height="20" viewBox="0 0 28 28" fill="none"><path d="M14 2L24 7.5V20.5L14 26L4 20.5V7.5L14 2Z" fill="white" fill-opacity="0.15" stroke="white" stroke-width="1.5"/><path d="M16.5 8H12L10.5 14H13.5L11.5 20L19 12.5H15L16.5 8Z" fill="white"/></svg>
              </div>
              <div>
                <h1 style="margin:0;font-size:18px;font-weight:800;color:#0f172a;">New Wholesale Order</h1>
                <p style="margin:0;font-size:13px;color:#64748b;">A customer has submitted an order via the Wholesale Portal</p>
              </div>
            </div>

            <div style="background:#f8fafc;border-radius:10px;padding:16px 20px;margin-bottom:20px;border:1px solid #e2e8f0;">
              <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <tr><td style="padding:4px 0;color:#64748b;width:130px;">Customer</td><td style="padding:4px 0;color:#0f172a;font-weight:600;">${session.name || '—'}${session.company ? ` <span style="color:#64748b;font-weight:400;">(${session.company})</span>` : ''}</td></tr>
                <tr><td style="padding:4px 0;color:#64748b;">Email</td><td style="padding:4px 0;color:#0f172a;">${session.email}</td></tr>
                <tr><td style="padding:4px 0;color:#64748b;">Order #</td><td style="padding:4px 0;color:#0f172a;">Wholesale Draft #${id}</td></tr>
                <tr><td style="padding:4px 0;color:#64748b;">Draft SO</td><td style="padding:4px 0;color:#2563eb;font-weight:700;">${soNumber}</td></tr>
                <tr><td style="padding:4px 0;color:#64748b;">Order Total</td><td style="padding:4px 0;color:#0f172a;font-weight:700;font-size:15px;">${fmtCurrency(Number(order.total_amount))}</td></tr>
                ${order.notes ? `<tr><td style="padding:4px 0;color:#64748b;vertical-align:top;">Notes</td><td style="padding:4px 0;color:#475569;">${order.notes}</td></tr>` : ''}
              </table>
            </div>

            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
              <thead>
                <tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0;">
                  <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Product</th>
                  <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">SKU</th>
                  <th style="padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Qty</th>
                  <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Unit Price</th>
                  <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Total</th>
                </tr>
              </thead>
              <tbody>${itemRows}</tbody>
              <tfoot>
                <tr style="border-top:2px solid #e2e8f0;">
                  <td colspan="4" style="padding:10px 10px;text-align:right;font-size:14px;font-weight:700;color:#0f172a;">Order Total</td>
                  <td style="padding:10px 10px;text-align:right;font-size:15px;font-weight:800;color:#0f172a;">${fmtCurrency(Number(order.total_amount))}</td>
                </tr>
              </tfoot>
            </table>

            ${hasIndent ? `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#92400e;">⚠️ <strong>This order contains indent (back-order) items</strong> — some products have no stock on hand and will need to be sourced.</div>` : ''}

            <p style="font-size:13px;color:#64748b;border-top:1px solid #f1f5f9;padding-top:16px;margin:0;">
              Draft Sales Order <strong>${soNumber}</strong> has been created in IMS → Sales Orders for review and processing.
            </p>
          </div>
        `,
      }).catch(err => console.error('[wholesale/submit] email send failed:', err));
    }

    return NextResponse.json({ success: true, so_id: soId, so_number: soNumber });
  } catch (e: any) {
    console.error('[wholesale/submit]', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
