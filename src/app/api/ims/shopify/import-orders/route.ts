/**
 * POST /api/ims/shopify/import-orders
 *
 * Pulls orders from Shopify (created on/after shopify_order_sync_from config),
 * creates ims_sales_orders with so_type='online', and commits stock.
 *
 * Skips orders that already exist (matching shopify_order_id).
 * Transitions: draft → confirmed (commits qty_committed)
 *              confirmed → fulfilled (moves stock) if order is already fulfilled.
 */
import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';
import { imsQuery, imsExecute, getIMSPool } from '@/services/IMSMySQLService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ShopifyService } from '@/services/ShopifyService';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { decrypt } from '@/lib/encryption';
import { toBusinessDate, toBusinessDateTime } from '@/lib/shopifyDate';
import { parseShopifyRefund } from '@/lib/shopifyRefund';
import { createNotification } from '@/lib/ims/createNotification';
import { triggerCNXeroSync } from '@/lib/ims/xeroHooks';
import { getOrCreateShopifyFallbackVariantId } from '@/lib/shopifyFallbackVariant';
import { getOrCreateOnlineCustomerId, resolveShopifyOrderCustomerId } from '@/lib/ims/shopifyOrderCustomer';

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


async function getSetting(businessId: string, key: string): Promise<string | null> {
  const rows = await imsQuery<{ value: string }>(
    'SELECT `value` FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1',
    [businessId, key],
  );
  return rows[0]?.value ?? null;
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const businessId: string = session.businessId ?? '';
  const disabled = await shopifyDisabledResponse(businessId); if (disabled) return disabled;

  await imsExecute(
    `ALTER TABLE ims_sales_orders
     ADD COLUMN gift_card_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total_amount`,
    [],
  ).catch(() => {});

  // Load config
  const syncEnabled = await getSetting(businessId, 'shopify_order_sync_enabled');
  if (syncEnabled !== '1') {
    return NextResponse.json({ error: 'Shopify order sync is disabled. Enable it in IMS → Shopify → Orders & Webhooks.' }, { status: 400 });
  }

  const syncFrom = await getSetting(businessId, 'shopify_order_sync_from');
  if (!syncFrom) {
    return NextResponse.json({
      error: 'shopify_order_sync_from is not configured. Set a transition date in IMS → Shopify → Orders tab first.',
    }, { status: 400 });
  }

  const locationIdStr = await getSetting(businessId, 'online_sales_location_id');
  if (!locationIdStr) {
    return NextResponse.json({
      error: 'online_sales_location_id is not configured. Set it in IMS → Shopify → Orders tab.',
    }, { status: 400 });
  }
  const locationId = Number(locationIdStr);

  // Default "Online Customer" that every online order is attributed to.
  const onlineCustomerId = await getOrCreateOnlineCustomerId(businessId);
  // Backfill any existing online orders that were imported before this default
  // existed (idempotent — only touches rows with no customer assigned).
  if (onlineCustomerId) {
    await imsExecute(
      `UPDATE ims_sales_orders SET customer_id = ?
        WHERE business_id = ? AND so_type = 'online' AND (customer_id IS NULL OR customer_id = 0)`,
      [onlineCustomerId, businessId],
    );
  }

  // Shopify credentials
  const { getShopifyAdminCredentials } = await import('@/lib/shopifyCredentials');
  const credentials = await getShopifyAdminCredentials(businessId);
  if (!credentials) {
    return NextResponse.json({ error: 'Shopify credentials not configured.' }, { status: 400 });
  }

  // Fetch orders from Shopify
  const shopify = new ShopifyService(credentials.shopDomain, credentials.token);
  let shopifyOrders: any[];
  try {
    // Fetch from (syncFrom − 1 day) so no order near the AEST/UTC midnight boundary
    // is missed. The exact cut-off is enforced in-code via toBusinessDate below.
    const buffered = new Date(`${syncFrom}T00:00:00Z`);
    buffered.setUTCDate(buffered.getUTCDate() - 1);
    const fetchFrom = buffered.toISOString().slice(0, 10);
    shopifyOrders = await shopify.getAllOrders(fetchFrom);
  } catch (e: any) {
    return NextResponse.json({ error: `Shopify API error: ${e.message}` }, { status: 500 });
  }

  // Build Shopify variant_id → IMS variant_id map for this business
  const variantRows = await imsQuery<{ variant_id: string; shopify_variant_id: string }>(
    `SELECT v.variant_id, v.shopify_variant_id
     FROM ims_product_variants v
     JOIN ims_products p ON p.product_id = v.product_id
     WHERE p.business_id = ? AND v.shopify_variant_id IS NOT NULL`,
    [businessId],
  );
  const shopifyToIms = new Map<string, string>(
    variantRows.map(r => [String(r.shopify_variant_id), r.variant_id]),
  );
  const fallbackVariantId = await getOrCreateShopifyFallbackVariantId(businessId);

  // Existing shopify orders — id → {id, status} so we can self-heal stuck drafts.
  const existingRows = await imsQuery<{ id: number; shopify_order_id: string; status: string; customer_id: number | null }>(
    `SELECT id, shopify_order_id, status, customer_id FROM ims_sales_orders
     WHERE business_id = ? AND shopify_order_id IS NOT NULL`,
    [businessId],
  );
  const existingById = new Map(existingRows.map(r => [String(r.shopify_order_id), r]));

  let imported = 0;
  let skippedExisting = 0;
  let confirmedDrafts = 0;
  let skippedNoItems = 0;
  let skippedPreTransition = 0;
  const errors: string[] = [];

  const backfillOrderRefunds = async (order: any, soId: number) => {
    if (!Array.isArray(order.refunds) || order.refunds.length === 0) return;

    const orderGateway = Array.isArray(order.payment_gateway_names) ? order.payment_gateway_names.join(', ') : null;
    for (const refund of order.refunds) {
      try {
        const norm = parseShopifyRefund(refund, orderGateway);
        if (!norm.shopifyRefundId) continue;

        await ImsSORepo.processShopifyRefund(businessId, {
          soId,
          shopifyRefundId: norm.shopifyRefundId,
          gateway: norm.gateway,
          amount: norm.amount,
          taxAmount: norm.taxAmount,
          note: 'Shopify refund (import backfill)',
          restockLines: norm.restockLines,
        });
        const cnRows = await imsQuery<{ id: number; xero_credit_note_id: string | null }>(
          `SELECT id, xero_credit_note_id FROM ims_credit_notes
           WHERE business_id = ? AND shopify_refund_id = ?
           LIMIT 1`,
          [businessId, norm.shopifyRefundId],
        );
        const cnId = Number(cnRows[0]?.id ?? 0);
        if (cnId > 0 && !cnRows[0]?.xero_credit_note_id) {
          await triggerCNXeroSync(businessId, cnId);
        }
      } catch (e: any) {
        errors.push(`Order ${order.name} refund: ${e.message}`);
      }
    }

    await imsExecute(
      `UPDATE ims_sales_orders SET financial_status = CASE
          WHEN refunded_amount >= total_amount THEN 'refunded'
          WHEN refunded_amount > 0 THEN 'partially_refunded'
          ELSE financial_status END
        WHERE id = ?`,
      [soId],
    );
  };

  for (const order of shopifyOrders) {
    const orderIdStr = String(order.id);
    const orderCustomerId = await resolveShopifyOrderCustomerId(
      businessId,
      order,
      onlineCustomerId,
      { createIfMissing: true },
    );

    // Already imported — but self-heal if it got stuck at draft (stock never committed).
    const existing = existingById.get(orderIdStr);
    if (existing) {
      if (orderCustomerId && Number(existing.customer_id) !== orderCustomerId) {
        await imsExecute(
          'UPDATE ims_sales_orders SET customer_id = ? WHERE id = ? AND business_id = ?',
          [orderCustomerId, existing.id, businessId],
        );
        existing.customer_id = orderCustomerId;
      }
      if (existing.status === 'draft') {
        try {
          // Backfill the real AEST order time (early imports stored date-only).
          await imsExecute(
            `UPDATE ims_sales_orders SET order_date = ? WHERE id = ?`,
            [toBusinessDateTime(order.created_at), existing.id],
          );
          // Apply the CURRENT Shopify state (re-fetched fresh), not the state at first import.
          if (order.cancelled_at || order.financial_status === 'voided') {
            // Cancelled on Shopify since import — mark cancelled (no stock committed from a draft).
            await ImsSORepo.changeStatus(existing.id, 'cancelled');
          } else {
            await ImsSORepo.changeStatus(existing.id, 'confirmed');
            // If it has since been fulfilled on Shopify, deduct stock now.
            if (order.fulfillment_status === 'fulfilled') {
              await ImsSORepo.changeStatus(existing.id, 'fulfilled');
            }
          }
          confirmedDrafts++;
        } catch (e: any) { errors.push(`Confirm ${order.name}: ${e.message}`); }
      } else {
        skippedExisting++;
      }
      await backfillOrderRefunds(order, existing.id);
      continue;
    }

    // Business-timezone order date (AEST) — the authoritative "what day" value.
    const orderDate = toBusinessDate(order.created_at);

    // Enforce the transition cut-off in business-local time (avoids the buffer day slipping through)
    if (orderDate < syncFrom) { skippedPreTransition++; continue; }

    // Map line items to IMS variants
    const items: { variant_id: string; shopify_line_item_id: string; qty_ordered: number; unit_price: number; tax_rate: number; notes: string }[] = [];
    for (const li of order.line_items ?? []) {
      const imsVariantId = shopifyToIms.get(String(li.variant_id ?? '')) ?? fallbackVariantId;
      items.push({
        variant_id:  imsVariantId,
        shopify_line_item_id: String(li.id ?? ''),
        qty_ordered: Number(li.quantity ?? 1),
        unit_price:  parseFloat(li.price ?? '0'),
        tax_rate:    0.1, // Australian GST
        notes:       li.name ?? '',
      });
    }

    const giftCardAmount = getShopifyGiftCardAmount(order.line_items ?? []);
    if (items.length === 0) { skippedNoItems++; continue; }

    const freight   = parseFloat(order.total_shipping_price_set?.shop_money?.amount ?? '0');
    const discount  = parseFloat(order.total_discounts ?? '0');

    try {
      // Create as draft first (ImsSalesOrdersRepo.create doesn't set so_type)
      await ImsSORepo.ensureTaxTreatmentColumn();
      const pool = await getIMSPool();
      const poolConn = await pool.getConnection();
      let soId: number;
      try {
        const soNumber = `ONL-${orderDate.replace(/-/g, '')}-${orderIdStr.slice(-6)}`;
        // Store the full AEST order timestamp so the day view can show real order times.
        const orderDateTime = toBusinessDateTime(order.created_at);
        // Use Shopify's authoritative money fields — prices are GST-inclusive for AU stores,
        // so total_tax is the real GST (total/11), NOT subtotal × 0.1.
        const subtotal    = parseFloat(order.subtotal_price ?? '0');
        const taxAmount   = parseFloat(order.total_tax ?? '0');
        const totalAmount = parseFloat(order.total_price ?? '0');
        const gateway     = Array.isArray(order.payment_gateway_names) ? order.payment_gateway_names.join(', ') : null;
        const [result] = await poolConn.execute<any>(
          `INSERT INTO ims_sales_orders
             (business_id, so_number, so_type, customer_id, location_id, status, order_date, freight, discount,
              subtotal, tax_amount, total_amount, shopify_order_id, shopify_order_name, payment_gateway, financial_status, price_tier, tax_treatment, notes)
            VALUES (?, ?, 'online', ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'retail', 'inc_tax', ?)`,
          [
            businessId, soNumber, orderCustomerId, locationId, orderDateTime, freight, discount,
            subtotal, taxAmount, totalAmount, orderIdStr, order.name ?? null,
            gateway, order.financial_status ?? null,
            `Shopify order ${order.name ?? ''}`.trim(),
          ],
        );
        soId = result.insertId;

        // Insert line items
        for (const it of items) {
          const lineTotal = it.qty_ordered * it.unit_price;
          await poolConn.execute(
            `INSERT INTO ims_sales_order_items
               (business_id, so_id, shopify_line_item_id, variant_id, qty_ordered, qty_fulfilled, unit_price, discount_pct, tax_rate, line_total, notes)
             VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)`,
            [businessId, soId, it.shopify_line_item_id || null, it.variant_id, it.qty_ordered, it.unit_price, it.tax_rate, lineTotal, it.notes],
          );
        }
      } finally {
        poolConn.release();
      }

      // Transition draft → confirmed (commits qty_committed)
      await ImsSORepo.changeStatus(soId, 'confirmed');

      // If already fulfilled on Shopify → move stock now
      if (order.fulfillment_status === 'fulfilled') {
        await ImsSORepo.changeStatus(soId, 'fulfilled');
      }

      // If cancelled on Shopify → cancel it
      if (order.financial_status === 'voided' || order.cancelled_at) {
        await ImsSORepo.changeStatus(soId, 'cancelled');
      }

      // Process any refunds already recorded on the order (restock + record $).
      await backfillOrderRefunds(order, soId);

      imported++;
    } catch (e: any) {
      errors.push(`Order ${order.name}: ${e.message}`);
    }
  }

  // If any refund/confirm errors occurred, persist a notification for the IMS operator.
  if (errors.length > 0) {
    createNotification(
      businessId,
      'shopify_import',
      `Shopify Import Errors (${errors.length})`,
      errors[0],
      { errors },
    ).catch(err => console.error('[notifications] import notify failed:', err));
  }

  return NextResponse.json({
    success: true,
    total_from_shopify: shopifyOrders.length,
    imported,
    confirmed_drafts: confirmedDrafts,
    skipped_existing: skippedExisting,
    skipped_no_items: skippedNoItems,
    skipped_pre_transition: skippedPreTransition,
    errors: errors.slice(0, 20),
  });
}
