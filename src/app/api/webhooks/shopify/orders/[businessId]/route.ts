/**
 * POST /api/webhooks/shopify/orders/[businessId]
 *
 * Per-business Shopify webhook receiver for real-time order events.
 * Each business registers its OWN URL (with its businessId in the path) in
 * Shopify Admin → Settings → Notifications → Webhooks, so events are always
 * routed to the correct tenant — no ambiguous "first match" lookup.
 *
 * Handles: orders/create, orders/paid, orders/cancelled, fulfillments/create, fulfillments/update,
 * refunds/create, shopify_payments/payouts/create, shopify_payments/payouts/update
 *
 * The webhook signing secret is stored per-business in ims_settings as
 * 'shopify_webhook_secret'.
 */
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { imsQuery, imsExecute, getIMSPool } from '@/services/IMSMySQLService';
import { execute as mainExecute } from '@/services/MySQLService';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { toBusinessDate, toBusinessDateTime } from '@/lib/shopifyDate';
import { parseShopifyRefund } from '@/lib/shopifyRefund';
import { createNotification } from '@/lib/ims/createNotification';
import { runImsForBusiness, getImsDbNameStrict } from '@/lib/db/BusinessRegistry';
import { triggerCNXeroSync } from '@/lib/ims/xeroHooks';
import { getOrCreateShopifyFallbackVariantId } from '@/lib/shopifyFallbackVariant';
import { getShopifyApiCreds, ingestShopifyPayout } from '@/lib/ims/shopifyPayoutIngestion';
import { autoPostShopifyPayout } from '@/lib/ims/shopifyPayoutAutoPost';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getOrCreateOnlineCustomerId, resolveShopifyOrderCustomerId } from '@/lib/ims/shopifyOrderCustomer';
import { calculateShopifyEligibleSpend, calculateShopifyRefundEligibleSpend } from '@/lib/loyalty/calculations';
import { ShopifyLoyaltyService } from '@/lib/loyalty/ShopifyLoyaltyService';
import { fulfilSalesOrderPartial } from '@/lib/ims/orderResolution/customerFulfilment';
import { buildShopifyShipmentQuantities, parseShopifyShipment } from '@/lib/ims/shopifyFulfilment';
import { persistShopifyShipment } from '@/lib/ims/shopifyShipmentPersistence';

export const runtime = 'nodejs';

type Config = { businessId: string; secret: string; syncFrom: string; locationId: number; enabled: boolean };

function reportWebhookFailure(
  businessId: string,
  topic: string,
  error: unknown,
  context: Record<string, unknown>,
) {
  return reportRuntimeIssue({
    businessId,
    source: 'shopify_webhook',
    operation: topic || 'unknown_topic',
    title: `Shopify webhook failed — ${topic || 'unknown topic'}${context.shopify_order_name ? ` — ${context.shopify_order_name}` : ''}`,
    error,
    context,
    reference: context.shopify_order_id != null
      ? { type: 'shopify_order', id: String(context.shopify_order_id) }
      : context.payout_id != null
        ? { type: 'shopify_payout', id: String(context.payout_id) }
        : undefined,
  });
}

function getShopifyGiftCardAmount(lineItems: any[]): number {
  if (!Array.isArray(lineItems)) return 0;
  const total = lineItems.reduce((sum, li) => {
    if (!li?.gift_card) return sum;
    const qty = Number(li.quantity ?? 0);
    const price = Number(li.price ?? 0);
    if (!(qty > 0) || !(price >= 0)) return sum;
    return sum + (qty * price);
  }, 0);
  return Math.round(total * 100) / 100;
}

async function awardPaidOrderLoyalty(businessId: string, payload: any) {
  const shopifyOrderId = String(payload.id ?? '').trim();
  if (!shopifyOrderId) return;
  await ShopifyLoyaltyService.markPaidOrderRedemptionsUsed({
    businessId,
    shopifyOrderId,
    shopifyCustomerId: String(payload.customer?.id ?? '').trim(),
    discountCodes: Array.isArray(payload.discount_codes)
      ? payload.discount_codes.map((discount: any) => String(discount?.code ?? ''))
      : [],
  });
  const eligibleSpend = calculateShopifyEligibleSpend({
    subtotalPrice: Number(payload.subtotal_price ?? 0),
    lineItems: (payload.line_items ?? []).map((item: any) => ({
      quantity: Number(item.quantity ?? 0),
      price: item.price ?? 0,
      giftCard: Boolean(item.gift_card),
      discountAllocations: (item.discount_allocations ?? []).map((allocation: any) => ({
        amount: allocation?.amount ?? 0,
      })),
    })),
  });
  await ShopifyLoyaltyService.awardPaidOrder({
    businessId,
    shopifyOrderId,
    paidDate: toBusinessDate(payload.processed_at ?? payload.updated_at ?? payload.created_at),
    eligibleSpend,
  });
}

async function ensureGiftCardAmountColumn(): Promise<void> {
  await imsExecute(
    `ALTER TABLE ims_sales_orders
     ADD COLUMN gift_card_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total_amount`,
    [],
  ).catch(() => {});
}

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
    await ensureGiftCardAmountColumn();
    const orderDate = toBusinessDate(payload.created_at);
    if (orderDate < config.syncFrom) return respond();

    const orderIdStr = String(payload.id ?? '');

    const onlineCustomerId = await getOrCreateOnlineCustomerId(businessId);
    const customerId = await resolveShopifyOrderCustomerId(
      businessId,
      payload,
      onlineCustomerId,
      { createIfMissing: true },
    );
    const existing = await imsQuery<{ id: number; customer_id: number | null }>(
      `SELECT id, customer_id FROM ims_sales_orders WHERE shopify_order_id = ? AND business_id = ? LIMIT 1`,
      [orderIdStr, businessId],
    );
    if (existing.length > 0) {
      if (customerId && Number(existing[0].customer_id) !== customerId) {
        await imsExecute(
          'UPDATE ims_sales_orders SET customer_id = ? WHERE id = ? AND business_id = ?',
          [customerId, existing[0].id, businessId],
        );
      }
      if (topic === 'orders/paid') {
        await imsExecute(
          `UPDATE ims_sales_orders
              SET financial_status = 'paid'
            WHERE id = ? AND business_id = ?`,
          [existing[0].id, businessId],
        );
        try {
          await awardPaidOrderLoyalty(businessId, payload);
        } catch (error: any) {
          console.error('[shopify-webhook] paid-order loyalty error:', error?.message ?? String(error));
          return NextResponse.json({ error: error?.message ?? String(error) }, { status: 500 });
        }
      }
      return respond();
    }
    if (!config.locationId) return respond();

    const variantRows = await imsQuery<{ variant_id: string; shopify_variant_id: string }>(
      `SELECT v.variant_id, v.shopify_variant_id
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE p.business_id = ? AND v.shopify_variant_id IS NOT NULL`,
      [businessId],
    );
    const shopifyToIms = new Map(variantRows.map(r => [String(r.shopify_variant_id), r.variant_id]));

    const fallbackVariantId = await getOrCreateShopifyFallbackVariantId(businessId);
    const items: any[] = [];
    const giftCardAmount = getShopifyGiftCardAmount(payload.line_items ?? []);
    for (const li of payload.line_items ?? []) {
      const imsId = shopifyToIms.get(String(li.variant_id ?? '')) ?? fallbackVariantId;
      const qty = Number(li.quantity ?? 1);
      const unitPrice = parseFloat(li.price ?? '0');
      items.push({
        shopify_line_item_id: String(li.id ?? ''),
        variant_id: imsId,
        qty_ordered: qty,
        unit_price: unitPrice,
        line_total: qty * unitPrice,
        notes: li.name ?? '',
      });
    }
    if (!items.length && giftCardAmount <= 0) return respond();

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
             (business_id, so_number, so_type, customer_id, location_id, status, order_date, freight, discount,
              subtotal, tax_amount, total_amount, gift_card_amount, shopify_order_id, shopify_order_name, payment_gateway, financial_status, price_tier, tax_treatment, notes)
            VALUES (?, ?, 'online', ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'retail', 'inc_tax', ?)`,
          [businessId, soNumber, customerId, config.locationId, orderDateTime, freight, discount,
            subtotal, taxAmount, parseFloat(payload.total_price ?? '0'), giftCardAmount, orderIdStr, payload.name ?? null,
           gateway, topic === 'orders/paid' ? 'paid' : payload.financial_status ?? null,
           `Shopify ${payload.name ?? ''}`.trim()],
        );
        soId = r.insertId;
        for (const it of items) {
          await conn.execute(
            `INSERT INTO ims_sales_order_items
               (business_id, so_id, shopify_line_item_id, variant_id, qty_ordered, qty_fulfilled, unit_price, discount_pct, tax_rate, line_total, notes)
             VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0.1, ?, ?)`,
            [businessId, soId, it.shopify_line_item_id || null, it.variant_id, it.qty_ordered, it.unit_price, it.line_total, it.notes],
          );
        }
      } finally { conn.release(); }

      await ImsSORepo.changeStatus(soId, 'confirmed');
      if (payload.fulfillment_status === 'fulfilled') await ImsSORepo.changeStatus(soId, 'fulfilled');
      if (topic === 'orders/paid') await awardPaidOrderLoyalty(businessId, payload);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error('[shopify-webhook] order create error:', msg);
      await reportWebhookFailure(businessId, topic, e, {
        shopify_order_id: String(payload.id ?? ''),
        shopify_order_name: payload.name ?? null,
      });
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
        await reportWebhookFailure(businessId, topic, e, {
          shopify_order_id: orderIdStr,
          so_id: existing[0].id,
        });
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

  // ── fulfilments ───────────────────────────────────────────────────────────────
  if (topic === 'fulfillments/create' || topic === 'fulfillments/update' || topic === 'orders/fulfilled') {
    const orderId = String(payload.order_id ?? payload.id ?? '');
    const existing = await imsQuery<{
      id: number; status: string; shopify_order_name: string | null; location_id: number; location_name: string | null;
    }>(
      `SELECT so.id, so.status, so.shopify_order_name, so.location_id, l.name AS location_name
         FROM ims_sales_orders so
         LEFT JOIN ims_locations l ON l.id = so.location_id
        WHERE so.shopify_order_id = ? AND so.business_id = ? LIMIT 1`,
      [orderId, businessId],
    );
    const shipment = topic.startsWith('fulfillments/') ? parseShopifyShipment(payload) : null;
    if (existing.length && shipment && (
      topic === 'fulfillments/update'
      || !['confirmed', 'partially_fulfilled'].includes(existing[0].status)
    )) {
      await persistShopifyShipment({ businessId, soId: existing[0].id, shipment });
    }
    if (topic !== 'fulfillments/update' && existing.length && ['confirmed', 'partially_fulfilled'].includes(existing[0].status)) {
      const order = existing[0];
      const orderItems = await imsQuery<{
        id: number; shopify_line_item_id: string | number | null; variant_id: string;
        qty_ordered: number | string; qty_fulfilled: number | string | null;
        sku: string | null; product_name: string | null;
      }>(
        `SELECT soi.id, soi.shopify_line_item_id, soi.variant_id, soi.qty_ordered, soi.qty_fulfilled,
                pv.sku, p.name AS product_name
           FROM ims_sales_order_items soi
           LEFT JOIN ims_product_variants pv ON pv.variant_id = soi.variant_id
           LEFT JOIN ims_products p ON p.product_id = pv.product_id
          WHERE soi.so_id = ?
          ORDER BY soi.id`,
        [order.id],
      );
      let shipmentQuantities: Array<{ itemId: number; quantity: number }> = [];
      try {
        shipmentQuantities = buildShopifyShipmentQuantities({
          topic,
          payloadLines: Array.isArray(payload.line_items)
            ? payload.line_items.map((line: any) => ({ id: line.id ?? line.line_item_id, quantity: line.quantity }))
            : [],
          orderItems,
        });
        const fulfilmentResult = await fulfilSalesOrderPartial({
          businessId,
          soId: order.id,
          operationKey: `shopify:${topic}:${String(payload.id ?? orderId)}`,
          shipmentQuantities,
          allowIncomingCoveredStockShortfall: true,
          finalizeWhenComplete: true,
        });
        if (fulfilmentResult.incomingCoveredShortfalls?.length) {
          const incomingContext = {
            shopify_order_id: orderId,
            shopify_order_name: order.shopify_order_name,
            so_id: order.id,
            fulfilment_location: order.location_name,
            shortfalls: fulfilmentResult.incomingCoveredShortfalls,
          };
          await reportRuntimeIssue({
            businessId,
            source: 'shopify_webhook',
            operation: 'fulfilment_used_incoming_stock',
            severity: 'warning',
            title: 'Shopify fulfilment used incoming stock',
            error: new Error('Shopify fulfilment completed before incoming stock was received.'),
            context: incomingContext,
            reference: { type: 'sales_order', id: String(order.id) },
          });
          createNotification(
            businessId,
            'shopify_webhook',
            `Incoming Stock Used — ${order.shopify_order_name || orderId}`,
            'Shopify marked this order fulfilled before incoming stock was received. Solvantis completed the fulfilment and allowed stock to go negative temporarily. Receive the pending supply and verify the location stock.',
            incomingContext,
          ).catch(console.error);
        }
        if (shipment) await persistShopifyShipment({ businessId, soId: order.id, shipment });
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.error('[shopify-webhook] fulfillments/create error:', msg);
        const requestedItemIds = new Set(shipmentQuantities.map(line => line.itemId));
        const errorItemIds = new Set<number>(
          Array.isArray(e?.shortfalls)
            ? e.shortfalls.map((shortfall: any) => Number(shortfall?.itemId)).filter(Number.isInteger)
            : [],
        );
        const messageItemId = Number(msg.match(/item (\d+)/i)?.[1] ?? 0);
        if (messageItemId > 0) errorItemIds.add(messageItemId);
        const relevantItemIds = errorItemIds.size > 0 ? errorItemIds : requestedItemIds;
        const affectedItems = orderItems.filter(item => relevantItemIds.size === 0 || relevantItemIds.has(Number(item.id)));
        const variantIds = [...new Set(affectedItems.map(item => item.variant_id).filter(Boolean))];
        const stockRows = variantIds.length > 0
          ? await imsQuery<{
              variant_id: string; location_id: number; location_name: string;
              qty_on_hand: number | string; qty_committed: number | string;
            }>(
              `SELECT s.variant_id, s.location_id, l.name AS location_name, s.qty_on_hand, s.qty_committed
                 FROM ims_stock s
                 JOIN ims_locations l ON l.id = s.location_id
                WHERE s.variant_id IN (${variantIds.map(() => '?').join(',')})
                ORDER BY l.name`,
              variantIds,
            )
          : [];
        const itemDetails = affectedItems.map(item => ({
          item_id: Number(item.id),
          sku: item.sku,
          product_name: item.product_name,
          requested_quantity: shipmentQuantities.find(line => line.itemId === Number(item.id))?.quantity ?? null,
          stock: stockRows
            .filter(stock => stock.variant_id === item.variant_id)
            .map(stock => ({
              location: stock.location_name,
              is_fulfilment_location: Number(stock.location_id) === Number(order.location_id),
              qty_on_hand: Number(stock.qty_on_hand),
              qty_committed: Number(stock.qty_committed),
              available: Number(stock.qty_on_hand) - Number(stock.qty_committed),
            })),
        }));
        const firstItem = itemDetails[0];
        const notificationMessage = [
          `${order.shopify_order_name || `Shopify order ${orderId}`}: ${msg}`,
          firstItem ? `${firstItem.sku || 'No SKU'} — ${firstItem.product_name || 'Unknown product'}` : '',
          `Fulfilment location: ${order.location_name || `location ${order.location_id}`}. Complete any required branch transfer, then retry fulfilment.`,
        ].filter(Boolean).join('\n');
        await reportWebhookFailure(businessId, topic, e, {
          shopify_order_id: orderId,
          shopify_order_name: order.shopify_order_name,
          so_id: order.id,
          fulfilment_location: order.location_name,
          items: itemDetails,
        });
        createNotification(
          businessId,
          'shopify_webhook',
          `Shopify Fulfilment Needs Attention — ${order.shopify_order_name || orderId}`,
          notificationMessage,
          {
            topic,
            shopify_order_id: orderId,
            shopify_order_name: order.shopify_order_name,
            so_id: order.id,
            fulfilment_location: order.location_name,
            items: itemDetails,
            error: msg,
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
            const eligibleRefundSpend = calculateShopifyRefundEligibleSpend({
              refundLineItems: (payload.refund_line_items ?? []).map((item: any) => ({
                subtotal: item?.subtotal ?? 0,
                totalTax: item?.total_tax ?? 0,
                giftCard: Boolean(item?.line_item?.gift_card),
              })),
            });
            await ShopifyLoyaltyService.reverseRefund({
              businessId,
              shopifyOrderId: orderId,
              shopifyRefundId: norm.shopifyRefundId,
              eligibleRefundSpend,
            });
            const cnRows = await imsQuery<{ id: number }>(
              `SELECT id FROM ims_credit_notes
               WHERE business_id = ? AND shopify_refund_id = ?
               LIMIT 1`,
              [businessId, norm.shopifyRefundId],
            );
            const cnId = Number(cnRows[0]?.id ?? 0);
            if (cnId > 0) {
              triggerCNXeroSync(businessId, cnId).catch(async (err: any) => {
                console.error('[Xero] Shopify refund CN sync failed:', err?.message);
                await reportRuntimeIssue({
                  businessId,
                  source: 'xero',
                  operation: 'shopify_refund_credit_note',
                  title: 'Shopify refund credit note sync failed',
                  error: err,
                  context: { shopify_order_id: orderId, shopify_refund_id: norm.shopifyRefundId },
                  reference: { type: 'credit_note', id: cnId },
                });
              });
            }
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
        } catch (e: any) {
          console.error('[shopify-webhook] refund error:', e.message);
          await reportWebhookFailure(businessId, topic, e, {
            shopify_order_id: orderId,
            so_id: existing[0].id,
            shopify_refund_id: String(payload.id ?? ''),
          });
          return respond({ error: e?.message ?? 'Shopify refund processing failed' }, 500);
        }
      }
    }
  }

  // ── orders/updated ──────────────────────────────────────────────────────────
  // Handles merchant edits: price changes, line item additions/removals, financial status.
  // Doesn't re-process status transitions (those are handled by other topics).
  if (topic === 'orders/updated') {
    await ensureGiftCardAmountColumn();
    const orderIdStr = String(payload.id ?? '');
    if (orderIdStr) {
      const existing = await imsQuery<{ id: number; status: string }>(
        `SELECT id, status FROM ims_sales_orders WHERE shopify_order_id = ? AND business_id = ? LIMIT 1`,
        [orderIdStr, businessId],
      );
      if (existing.length) {
        const so = existing[0];
        try {
          const customerId = await resolveShopifyOrderCustomerId(businessId, payload);
          // Draft and confirmed orders have not moved on-hand stock. The repository
          // transaction safely releases old commitments and commits replacement lines.
          if ((so.status === 'draft' || so.status === 'confirmed') && Array.isArray(payload.line_items)) {
            const fallbackVariantId = await getOrCreateShopifyFallbackVariantId(businessId);
            const variantRows = await imsQuery<{ variant_id: string; shopify_variant_id: string }>(
              `SELECT v.variant_id, v.shopify_variant_id
                 FROM ims_product_variants v JOIN ims_products p ON p.product_id = v.product_id
                WHERE p.business_id = ? AND v.shopify_variant_id IS NOT NULL`,
              [businessId],
            );
            const shopifyToIms = new Map(variantRows.map(r => [String(r.shopify_variant_id), r.variant_id]));
            const items = payload.line_items.map((li: any) => {
              const qty = Number(li.quantity ?? 1);
              const unitPrice = parseFloat(li.price ?? '0');
              return {
                shopify_line_item_id: String(li.id ?? '') || null,
                variant_id: shopifyToIms.get(String(li.variant_id ?? '')) ?? fallbackVariantId,
                qty_ordered: qty,
                unit_price: unitPrice,
                discount_pct: 0,
                tax_rate: 0.1,
                line_total: qty * unitPrice,
                notes: li.name ?? '',
              };
            });
            await ImsSORepo.update(so.id, {}, items);
          }

          // Always update financial fields.
          const subtotal    = parseFloat(payload.subtotal_price ?? '0');
          const taxAmount   = parseFloat(payload.total_tax ?? '0');
          const totalAmount = parseFloat(payload.total_price ?? '0');
          const freight     = parseFloat(payload.total_shipping_price_set?.shop_money?.amount ?? '0');
          const discount    = parseFloat(payload.total_discounts ?? '0');
          const gateway     = Array.isArray(payload.payment_gateway_names) ? payload.payment_gateway_names.join(', ') : null;
           const giftCardAmount = getShopifyGiftCardAmount(payload.line_items ?? []);
          await imsExecute(
            `UPDATE ims_sales_orders
               SET subtotal = ?, tax_amount = ?, total_amount = ?, freight = ?, discount = ?,
                 gift_card_amount = ?,
                   customer_id = COALESCE(?, customer_id),
                   financial_status = COALESCE(?, financial_status),
                   payment_gateway  = COALESCE(?, payment_gateway),
                   shopify_order_name = COALESCE(?, shopify_order_name)
             WHERE id = ?`,
            [subtotal, taxAmount, totalAmount, freight, discount,
             giftCardAmount, customerId,
             payload.financial_status ?? null, gateway, payload.name ?? null, so.id],
          );
        } catch (e: any) {
          console.error('[shopify-webhook] orders/updated error:', e.message);
          await reportWebhookFailure(businessId, topic, e, {
            shopify_order_id: orderIdStr,
            so_id: so.id,
          });
          return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
        }
      }
    }
  }

  // ── shopify_payments/payouts/* ────────────────────────────────────────────
  if (topic.startsWith('shopify_payments/payouts/')) {
    const payoutId = String(payload?.id ?? payload?.payout?.id ?? payload?.payout_id ?? '').trim();
    if (!payoutId) return respond();

    try {
      const creds = await getShopifyApiCreds(businessId);
      await ingestShopifyPayout(businessId, payload, creds);
      await autoPostShopifyPayout(businessId, payoutId);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      await reportWebhookFailure(businessId, topic, e, { payout_id: payoutId });
      createNotification(
        businessId,
        'shopify_webhook',
        `Shopify Webhook Failed — ${topic}`,
        msg,
        {
          topic,
          payout_id: payoutId,
          error: msg,
        },
      ).catch(console.error);
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
