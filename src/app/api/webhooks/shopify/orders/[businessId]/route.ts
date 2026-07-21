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
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { toBusinessDate, toBusinessDateTime } from '@/lib/shopifyDate';
import { parseShopifyRefund } from '@/lib/shopifyRefund';
import { createNotification } from '@/lib/ims/createNotification';
import { runImsForBusiness, getImsDbNameStrict } from '@/lib/db/BusinessRegistry';

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

export async function POST(req: Request, ctx: { params: { businessId: string } }) {
  // Webhooks carry no session cookie — bind the tenant schema via the
  // callback-form context (enterWith does not propagate across awaits).
  const mapped = await getImsDbNameStrict(ctx.params.businessId);
  // Unknown business → 200 so Shopify doesn't deactivate the webhook, but do
  // NOT touch the default schema.
  if (!mapped) return NextResponse.json({ ok: true });
  return runImsForBusiness(ctx.params.businessId, () => handleWebhook(req, ctx));
}

async function handleWebhook(req: Request, { params }: { params: { businessId: string } }) {
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
        await ImsSORepo.ensureTaxTreatmentColumn();
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
              subtotal, tax_amount, total_amount, shopify_order_id, shopify_order_name, payment_gateway, financial_status, price_tier, tax_treatment, notes)
            VALUES (?, ?, 'online', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'retail', 'inc_tax', ?)`,
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
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error('[shopify-webhook] order create error:', msg);
      createNotification(
        businessId,
        'shopify_webhook',
        `Shopify Webhook Failed — ${topic}`,
        msg,
        {
          topic,
          shopify_order_id:   String(payload.id ?? ''),
          shopify_order_name: payload.name ?? null,
          error:              msg,
        },
      ).catch(console.error);
      // Return 500 so Shopify retries the webhook delivery
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // ── orders/cancelled ─────────────────────────────────────────────────────────
  if (topic === 'orders/cancelled') {
    const orderIdStr = String(payload.id ?? '');
    const existing = await imsQuery<{ id: number; status: string }>(
      `SELECT id, status FROM ims_sales_orders WHERE shopify_order_id = ? AND business_id = ? LIMIT 1`,
      [orderIdStr, businessId],
    );
    if (existing.length && existing[0].status !== 'cancelled') {
      try { await ImsSORepo.changeStatus(existing[0].id, 'cancelled'); } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.error('[shopify-webhook] orders/cancelled error:', msg);
        createNotification(
          businessId,
          'shopify_webhook',
          'Shopify Webhook Failed — orders/cancelled',
          msg,
          {
            topic,
            shopify_order_id: orderIdStr,
            so_id:            existing[0].id,
            error:            msg,
          },
        ).catch(console.error);
      }
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
      try { await ImsSORepo.changeStatus(existing[0].id, 'fulfilled'); } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.error('[shopify-webhook] fulfillments/create error:', msg);
        createNotification(
          businessId,
          'shopify_webhook',
          'Shopify Webhook Failed — fulfillments/create',
          msg,
          {
            topic,
            shopify_order_id: orderId,
            so_id:            existing[0].id,
            error:            msg,
          },
        ).catch(console.error);
      }
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

  // ── returns/update ──────────────────────────────────────────────────────────
  // REST API only fires returns/update (not returns/approve or returns/close).
  // The payload is a diff object linked to the return by admin_graphql_api_id.
  // We log it for visibility; the refunds/create webhook handles the actual
  // stock restock and credit note creation when money moves.
  if (topic === 'returns/update') {
    const ret = payload.return ?? payload;
    console.info(`[shopify-webhook] returns/update: return ${ret.admin_graphql_api_id ?? ret.id} — use refunds/create for CN creation`);
  }

  return respond();
}
