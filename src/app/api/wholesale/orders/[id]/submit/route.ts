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
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { createNotification } from '@/lib/ims/createNotification';
import { Resend } from 'resend';
import { validateWholesaleOrderItems, WholesaleItemValidationError } from '@/lib/wholesale/wholesaleOrderItems';

type Ctx = { params: { id: string } };

const fmtCurrency = (n: number) =>
  `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const todayIso = () => new Date().toISOString().slice(0, 10);

export async function POST(_req: Request, { params }: Ctx) {
  const { session, brandAccess, response } = await requireActiveWholesaleSession();
  if (response) return response;
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  return runImsForBusiness(session.businessId, async () => {
   try {
    // ── 1. Fetch draft order + items ─────────────────────────────────────────
    const orderRows = await imsQuery<any>(
      `SELECT * FROM wholesale_draft_orders
        WHERE id = ? AND business_id = ? AND contact_id = ?
          AND wholesale_company_id = ? AND wholesale_location_id = ? AND wholesale_member_id = ?`,
      [id, session.businessId, session.contactId, session.companyId, session.locationId, session.memberId],
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
    const validatedItems = await validateWholesaleOrderItems(session.businessId, brandAccess, items);
    for (let index = 0; index < items.length; index += 1) {
      Object.assign(items[index], validatedItems[index], {
        line_total: Number(validatedItems[index].qty) * Number(validatedItems[index].unit_price),
      });
    }

    // Recompute indent quantities from live availability; client flags are advisory only.
    const variantIds = items.map((item: any) => item.variant_id);
    const stockPlaceholders = variantIds.map(() => '?').join(',');
    const stockRows = await imsQuery<{ variant_id: string; available: number; allow_indent_wholesale: number }>(
      `SELECT pv.variant_id, p.allow_indent_wholesale,
              GREATEST(0, COALESCE(SUM(s.qty_on_hand),0) - COALESCE(SUM(s.qty_committed),0)) AS available
         FROM ims_product_variants pv
         JOIN ims_products p ON p.product_id = pv.product_id AND p.business_id = ?
         LEFT JOIN ims_stock s ON s.variant_id = pv.variant_id AND s.business_id = ?
        WHERE pv.variant_id IN (${stockPlaceholders})
        GROUP BY pv.variant_id, p.allow_indent_wholesale`,
      [session.businessId, session.businessId, ...variantIds],
    );
    const liveStock = new Map(stockRows.map(row => [row.variant_id, row]));
    for (const item of items) {
      const stock = liveStock.get(item.variant_id);
      item.indent_qty = Math.max(0, Number(item.qty) - Number(stock?.available ?? 0));
      item.is_indent = item.indent_qty > 0;
    }

    const overstock = items
        .filter((item: any) => item.indent_qty > 0 && !Number(liveStock.get(item.variant_id)?.allow_indent_wholesale ?? 0))
        .map((i: any) => ({
          product_name:  i.product_name,
          variant_label: i.variant_label ?? null,
          qty_requested: i.qty,
          qty_available: Number(liveStock.get(i.variant_id)?.available ?? 0),
        }));

    if (overstock.length > 0) {
      return NextResponse.json(
        { error: 'Some items exceed available stock and are not enabled for indent ordering.', overstock },
        { status: 409 },
      );
    }
    for (const item of items) {
      await imsExecute(
        `UPDATE wholesale_draft_order_items SET is_indent = ?, indent_qty = ? WHERE id = ? AND order_id = ?`,
        [item.is_indent ? 1 : 0, item.indent_qty, item.id, id],
      );
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

    const accountRows = await imsQuery<any>(
      `SELECT wc.payment_terms,
              wl.shipping_address, wl.shipping_address2, wl.shipping_suburb, wl.shipping_city,
              wl.shipping_state, wl.shipping_postcode, wl.shipping_country
         FROM ims_wholesale_company_members wm
         JOIN ims_wholesale_companies wc
           ON wc.id = wm.company_id AND wc.business_id = wm.business_id AND wc.status = 'active'
         JOIN ims_wholesale_company_locations wl
           ON wl.id = wm.location_id AND wl.company_id = wm.company_id
          AND wl.business_id = wm.business_id AND wl.status = 'active'
        WHERE wm.id = ? AND wm.business_id = ? AND wm.contact_id = ?
          AND wm.company_id = ? AND wm.location_id = ? AND wm.is_active = 1
        LIMIT 1`,
      [session.memberId, session.businessId, session.contactId, session.companyId, session.locationId],
    );
    const account = accountRows[0];
    if (!account) {
      return NextResponse.json(
        { error: 'Your buying location is no longer available. Sign in again or contact your account manager.' },
        { status: 409 },
      );
    }

    // ── 3. Create Draft Sales Order ──────────────────────────────────────────
    const soItems = items.map((item: any) => ({
      variant_id:  item.variant_id,
      qty_ordered: item.qty,
      unit_price:  Number(item.unit_price),
      discount_pct: 0,
      tax_rate:    taxRate,
      line_total:  Number(item.line_total),
      notes:       item.indent_qty > 0 ? `${item.indent_qty} on indent` : undefined,
    }));

    const soNotes = [
      `Wholesale Portal order #${id} submitted by ${session.name || session.email}${session.company ? ` (${session.company})` : ''}.`,
      order.notes ? `Customer notes: ${order.notes}` : '',
    ].filter(Boolean).join('\n');

    const soId = await ImsSORepo.create(
      {
        so_number:    '',       // auto-generated
        customer_id:  session.contactId,
        wholesale_company_id: session.companyId,
        wholesale_location_id: session.locationId,
        wholesale_member_id: session.memberId,
        location_id:  locationId,
        status:       'draft',
        order_date:   todayIso(),
        delivery_address: account.shipping_address ?? undefined,
        delivery_address2: account.shipping_address2 ?? undefined,
        delivery_suburb: account.shipping_suburb ?? undefined,
        delivery_city: account.shipping_city ?? undefined,
        delivery_state: account.shipping_state ?? undefined,
        delivery_postcode: account.shipping_postcode ?? undefined,
        delivery_country: account.shipping_country ?? undefined,
        payment_terms: account.payment_terms ?? undefined,
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
        WHERE id = ? AND business_id = ?
          AND wholesale_company_id = ? AND wholesale_location_id = ? AND wholesale_member_id = ?`,
      [soId, id, session.businessId, session.companyId, session.locationId, session.memberId],
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
      const appUrlRaw = process.env.APP_URL ?? 'https://solvantis.com.au';
      const appUrl = (/^https?:\/\//i.test(appUrlRaw) ? appUrlRaw : `https://${appUrlRaw}`).replace(/\/$/, '');

      resend.emails.send({
        from,
        to: notifyEmail,
        subject: `New Wholesale Order — ${soNumber} from ${session.name || session.email}`,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:620px;margin:0 auto;padding:32px;background:#fff;border-radius:12px;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
              <img src="${appUrl}/brand/png/solvantis-icon-192.png" width="38" height="38" alt="Solvantis" style="display:block;border-radius:8px;flex-shrink:0;" />
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
    return NextResponse.json({ success: false, error: e.message }, { status: e instanceof WholesaleItemValidationError ? 409 : 500 });
  }
  });
}
