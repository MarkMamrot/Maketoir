/**
 * POST /api/webhooks/shopify/orders/[businessId]
 *
 * Per-business Shopify webhook receiver for real-time order events.
 * Each business registers its OWN URL (with its businessId in the path) in
 * Shopify Admin → Settings → Notifications → Webhooks, so events are always
 * routed to the correct tenant — no ambiguous "first match" lookup.
 *
 * Handles: orders/create, orders/paid, orders/cancelled, fulfillments/create, refunds/create
 *
 * The webhook signing secret is stored per-business in ims_settings as
 * 'shopify_webhook_secret'.
 */
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { imsQuery, imsExecute, getIMSPool } from '@/services/IMSMySQLService';
import { ImsSORepo, ImsCNRepo } from '@/lib/ims/ImsRepository';
import { toBusinessDate, toBusinessDateTime } from '@/lib/shopifyDate';
import { parseShopifyRefund } from '@/lib/shopifyRefund';

export const runtime = 'nodejs';

type Config = { businessId: string; secret: string; syncFrom: string; locationId: number; enabled: boolean };

async function getConfig(businessId: string): Promise<Config | null> {
  const rows = await imsQuery<{ key: string; value: string }>(
    `SELECT \`key\`, value FROM ims_settings
     WHERE business_id = ?
       AND \`key\` IN ('shopify_webhook_secret','shopify_order_sync_from','online_sales_location_id','shopify_order_sync_enabled')`,
    [businessId],
  );
  const get = (k: string) => rows.find(r => r.key === k)?.value ?? '';
  const secret = get('shopify_webhook_secret');
  if (!secret) return null;
  return {
    businessId,
    secret,
    syncFrom:   get('shopify_order_sync_from') || '2026-07-01',
    locationId: Number(get('online_sales_location_id') || 0),
    enabled:    get('shopify_order_sync_enabled') === '1',
  };
}

export async function POST(req: Request, { params }: { params: { businessId: string } }) {
  const businessId = params.businessId;
  const rawBody = await req.text();
  const topic   = req.headers.get('x-shopify-topic') ?? '';
  const hmac    = req.headers.get('x-shopify-hmac-sha256') ?? '';

  const config = await getConfig(businessId);
  // Always return 200 for config/enable issues so Shopify doesn't deactivate the webhook.
  if (!config) return NextResponse.json({ ok: true });
  if (!config.enabled) return NextResponse.json({ ok: true });

  // Verify HMAC (timingSafeEqual throws on length mismatch — guard first)
  const computed = crypto.createHmac('sha256', config.secret).update(rawBody, 'utf8').digest('base64');
  let valid = false;
  try {
    const a = Buffer.from(computed);
    const b = Buffer.from(hmac);
    valid = hmac.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { valid = false; }
  if (!valid) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const respond = () => NextResponse.json({ ok: true });

  // ── orders/create ──────────────────────────────────────────────────────────
  if (topic === 'orders/create' || topic === 'orders/paid') {
    const orderDate = toBusinessDate(payload.created_at);
    if (orderDate < config.syncFrom) return respond();

    const orderIdStr = String(payload.id ?? '');

    const existing = await imsQuery<{ id: number }>(
      `SELECT id FROM ims_sales_orders WHERE shopify_order_id = ? AND business_id = ? LIMIT 1`,
      [orderIdStr, businessId],
    );
    if (existing.length > 0) return respond();
    if (!config.locationId) return respond();

    const variantRows = await imsQuery<{ variant_id: string; shopify_variant_id: string }>(
      `SELECT v.variant_id, v.shopify_variant_id
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE p.business_id = ? AND v.shopify_variant_id IS NOT NULL`,
      [businessId],
    );
    const shopifyToIms = new Map(variantRows.map(r => [String(r.shopify_variant_id), r.variant_id]));

    const items: any[] = [];
    for (const li of payload.line_items ?? []) {
      const imsId = shopifyToIms.get(String(li.variant_id ?? ''));
      if (!imsId) continue;
      items.push({ shopify_line_item_id: String(li.id ?? ''), variant_id: imsId, qty_ordered: li.quantity, unit_price: parseFloat(li.price ?? '0'), line_total: li.quantity * parseFloat(li.price ?? '0'), notes: li.name ?? '' });
    }
    if (!items.length) return respond();

    try {
      const pool = await getIMSPool();
      const conn = await pool.getConnection();
      let soId: number;
      try {
        const soNumber  = `ONL-${orderDate.replace(/-/g, '')}-${orderIdStr.slice(-6)}`;
        const orderDateTime = toBusinessDateTime(payload.created_at);
        const subtotal  = parseFloat(payload.subtotal_price ?? '0');
        const taxAmount = parseFloat(payload.total_tax ?? '0');
        const freight   = parseFloat(payload.total_shipping_price_set?.shop_money?.amount ?? '0');
        const discount  = parseFloat(payload.total_discounts ?? '0');
        const gateway   = Array.isArray(payload.payment_gateway_names) ? payload.payment_gateway_names.join(', ') : null;
        const [r] = await conn.execute<any>(
          `INSERT INTO ims_sales_orders
             (business_id, so_number, so_type, location_id, status, order_date, freight, discount,
              subtotal, tax_amount, total_amount, shopify_order_id, shopify_order_name, payment_gateway, financial_status, notes)
           VALUES (?, ?, 'online', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [businessId, soNumber, config.locationId, orderDateTime, freight, discount,
           subtotal, taxAmount, parseFloat(payload.total_price ?? '0'), orderIdStr, payload.name ?? null,
           gateway, payload.financial_status ?? null,
           `Shopify ${payload.name ?? ''}`.trim()],
        );
        soId = r.insertId;
        for (const it of items) {
          await conn.execute(
            `INSERT INTO ims_sales_order_items
               (so_id, shopify_line_item_id, variant_id, qty_ordered, qty_fulfilled, unit_price, discount_pct, tax_rate, line_total, notes)
             VALUES (?, ?, ?, ?, 0, ?, 0, 0.1, ?, ?)`,
            [soId, it.shopify_line_item_id || null, it.variant_id, it.qty_ordered, it.unit_price, it.line_total, it.notes],
          );
        }
      } finally { conn.release(); }

      await ImsSORepo.changeStatus(soId, 'confirmed');
      if (payload.fulfillment_status === 'fulfilled') await ImsSORepo.changeStatus(soId, 'fulfilled');
    } catch (e: any) { console.error('[shopify-webhook] order create error:', e.message); }
  }

  // ── orders/cancelled ─────────────────────────────────────────────────────────
  if (topic === 'orders/cancelled') {
    const orderIdStr = String(payload.id ?? '');
    const existing = await imsQuery<{ id: number; status: string }>(
      `SELECT id, status FROM ims_sales_orders WHERE shopify_order_id = ? AND business_id = ? LIMIT 1`,
      [orderIdStr, businessId],
    );
    if (existing.length && existing[0].status !== 'cancelled') {
      try { await ImsSORepo.changeStatus(existing[0].id, 'cancelled'); } catch {}
    }
  }

  // ── fulfillments/create ───────────────────────────────────────────────────────
  if (topic === 'fulfillments/create' || topic === 'orders/fulfilled') {
    const orderId = String(payload.order_id ?? payload.id ?? '');
    const existing = await imsQuery<{ id: number; status: string }>(
      `SELECT id, status FROM ims_sales_orders WHERE shopify_order_id = ? AND business_id = ? LIMIT 1`,
      [orderId, businessId],
    );
    if (existing.length && existing[0].status === 'confirmed') {
      try { await ImsSORepo.changeStatus(existing[0].id, 'fulfilled'); } catch {}
    }
  }

  // ── refunds/create ────────────────────────────────────────────────────────
  // Shopify refund (full or partial). Restocks returned items and records the
  // refunded $ against the sales order. Idempotent on shopify_refund_id.
  if (topic === 'refunds/create') {
    const orderId = String(payload.order_id ?? '');
    if (orderId) {
      const existing = await imsQuery<{ id: number; payment_gateway: string | null }>(
        `SELECT id, payment_gateway FROM ims_sales_orders WHERE shopify_order_id = ? AND business_id = ? LIMIT 1`,
        [orderId, businessId],
      );
      if (existing.length) {
        try {
          const norm = parseShopifyRefund(payload, existing[0].payment_gateway);
          if (norm.shopifyRefundId) {
            await ImsSORepo.processShopifyRefund(businessId, {
              soId: existing[0].id,
              shopifyRefundId: norm.shopifyRefundId,
              shopifyReturnId: payload.return?.id ? String(payload.return.id) : null,
              gateway: norm.gateway,
              amount: norm.amount,
              taxAmount: norm.taxAmount,
              note: `Shopify refund via ${topic}`,
              restockLines: norm.restockLines,
            });
            // Reflect financial status if the whole order is now refunded.
            await imsQuery(
              `UPDATE ims_sales_orders SET financial_status = CASE
                  WHEN refunded_amount >= total_amount THEN 'refunded'
                  WHEN refunded_amount > 0 THEN 'partially_refunded'
                  ELSE financial_status END
                WHERE id = ?`,
              [existing[0].id],
            );
          }
        } catch (e: any) { console.error('[shopify-webhook] refund error:', e.message); }
      }
    }
  }

  // ── orders/updated ──────────────────────────────────────────────────────────
  // Handles merchant edits: price changes, line item additions/removals, financial status.
  // Doesn't re-process status transitions (those are handled by other topics).
  if (topic === 'orders/updated') {
    const orderIdStr = String(payload.id ?? '');
    if (orderIdStr) {
      const existing = await imsQuery<{ id: number; status: string }>(
        `SELECT id, status FROM ims_sales_orders WHERE shopify_order_id = ? AND business_id = ? LIMIT 1`,
        [orderIdStr, businessId],
      );
      if (existing.length) {
        const so = existing[0];
        try {
          // Always update financial fields.
          const subtotal    = parseFloat(payload.subtotal_price ?? '0');
          const taxAmount   = parseFloat(payload.total_tax ?? '0');
          const totalAmount = parseFloat(payload.total_price ?? '0');
          const freight     = parseFloat(payload.total_shipping_price_set?.shop_money?.amount ?? '0');
          const discount    = parseFloat(payload.total_discounts ?? '0');
          const gateway     = Array.isArray(payload.payment_gateway_names) ? payload.payment_gateway_names.join(', ') : null;
          await imsExecute(
            `UPDATE ims_sales_orders
               SET subtotal = ?, tax_amount = ?, total_amount = ?, freight = ?, discount = ?,
                   financial_status = COALESCE(?, financial_status),
                   payment_gateway  = COALESCE(?, payment_gateway),
                   shopify_order_name = COALESCE(?, shopify_order_name)
             WHERE id = ?`,
            [subtotal, taxAmount, totalAmount, freight, discount,
             payload.financial_status ?? null, gateway, payload.name ?? null, so.id],
          );

          // Only update line items when the SO hasn't committed stock yet (draft).
          if (so.status === 'draft' && Array.isArray(payload.line_items)) {
            const variantRows = await imsQuery<{ variant_id: string; shopify_variant_id: string }>(
              `SELECT v.variant_id, v.shopify_variant_id
                 FROM ims_product_variants v JOIN ims_products p ON p.product_id = v.product_id
                WHERE p.business_id = ?`,
              [businessId],
            );
            const shopifyToIms = new Map(variantRows.map(r => [String(r.shopify_variant_id), r.variant_id]));
            await imsExecute(`DELETE FROM ims_sales_order_items WHERE so_id = ?`, [so.id]);
            for (const li of payload.line_items) {
              const imsId = shopifyToIms.get(String(li.variant_id ?? ''));
              if (!imsId) continue;
              const qty = Number(li.quantity ?? 1);
              const price = parseFloat(li.price ?? '0');
              await imsExecute(
                `INSERT INTO ims_sales_order_items
                   (so_id, shopify_line_item_id, variant_id, qty_ordered, qty_fulfilled, unit_price, discount_pct, tax_rate, line_total, notes)
                 VALUES (?, ?, ?, ?, 0, ?, 0, 0.1, ?, ?)`,
                [so.id, String(li.id ?? '') || null, imsId, qty, price, qty * price, li.name ?? ''],
              );
            }
          }
        } catch (e: any) { console.error('[shopify-webhook] orders/updated error:', e.message); }
      }
    }
  }

  // ── returns/approve ──────────────────────────────────────────────────────────
  // Shopify Returns API — store approved a return request. The goods haven't
  // arrived yet, so we create an awaiting_product CN. No stock, no Xero yet.
  // When the matching refund fires (refunds/create with return.id), we complete it.
  if (topic === 'returns/approve') {
    const ret = payload.return ?? payload;
    const orderId = String(ret.order_id ?? '');
    const returnId = String(ret.id ?? '');
    if (orderId && returnId) {
      const existing = await imsQuery<{ id: number }>(
        `SELECT id FROM ims_sales_orders WHERE shopify_order_id = ? AND business_id = ? LIMIT 1`,
        [orderId, businessId],
      );
      if (existing.length) {
        try {
          const lineItems = (ret.return_line_items ?? []).map((rli: any) => ({
            shopifyVariantId: String(rli.line_item?.variant_id ?? rli.variant_id ?? ''),
            shopifyLineItemId: rli.line_item_id ?? null,
            quantity: Number(rli.quantity ?? 1),
            unitPrice: parseFloat(rli.line_item?.price ?? '0'),
            name: rli.line_item?.title ?? rli.line_item?.name ?? null,
            sku: rli.line_item?.sku ?? null,
          })).filter((l: any) => l.shopifyVariantId && l.quantity > 0);

          await ImsCNRepo.createFromShopifyReturn(businessId, {
            soId: existing[0].id,
            shopifyReturnId: returnId,
            lineItems,
          });
        } catch (e: any) { console.error('[shopify-webhook] returns/approve error:', e.message); }
      }
    }
  }

  // ── returns/close ────────────────────────────────────────────────────────────
  // Return lifecycle complete. If the CN is still awaiting (refund was issued
  // separately and already completed the CN), this is a no-op. If the return
  // was closed without a matching refund record (unusual), leave it awaiting —
  // the bookkeeper can complete it manually.
  if (topic === 'returns/close') {
    // Nothing to do — completion is driven by refunds/create. Logged for visibility.
    const ret = payload.return ?? payload;
    console.info(`[shopify-webhook] returns/close: return ${ret.id} order ${ret.order_id} — CN handled by refund flow`);
  }

  return respond();
}
