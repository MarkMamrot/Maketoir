/**
 * POST /api/webhooks/shopify/orders/[businessId]
 *
 * Per-business Shopify webhook receiver for real-time order events.
 * Each business registers its OWN URL (with its businessId in the path) in
 * Shopify Admin → Settings → Notifications → Webhooks, so events are always
 * routed to the correct tenant — no ambiguous "first match" lookup.
 *
 * Handles: orders/create, orders/paid, orders/cancelled, fulfillments/create
 *
 * The webhook signing secret is stored per-business in ims_settings as
 * 'shopify_webhook_secret'.
 */
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { imsQuery, getIMSPool } from '@/services/IMSMySQLService';
import { ImsSalesOrdersRepo } from '@/lib/ims/ImsRepository';
import { toBusinessDate, toBusinessDateTime } from '@/lib/shopifyDate';

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
      items.push({ variant_id: imsId, qty_ordered: li.quantity, unit_price: parseFloat(li.price ?? '0'), line_total: li.quantity * parseFloat(li.price ?? '0'), notes: li.name ?? '' });
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
        const [r] = await conn.execute<any>(
          `INSERT INTO ims_sales_orders
             (business_id, so_number, so_type, location_id, status, order_date, freight, discount,
              subtotal, tax_amount, total_amount, shopify_order_id, notes)
           VALUES (?, ?, 'online', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [businessId, soNumber, config.locationId, orderDateTime, freight, discount,
           subtotal, taxAmount, parseFloat(payload.total_price ?? '0'), orderIdStr,
           `Shopify ${payload.name ?? ''}`.trim()],
        );
        soId = r.insertId;
        for (const it of items) {
          await conn.execute(
            `INSERT INTO ims_sales_order_items
               (so_id, variant_id, qty_ordered, qty_fulfilled, unit_price, discount_pct, tax_rate, line_total, notes)
             VALUES (?, ?, ?, 0, ?, 0, 0.1, ?, ?)`,
            [soId, it.variant_id, it.qty_ordered, it.unit_price, it.line_total, it.notes],
          );
        }
      } finally { conn.release(); }

      await ImsSalesOrdersRepo.changeStatus(soId, 'confirmed');
      if (payload.fulfillment_status === 'fulfilled') await ImsSalesOrdersRepo.changeStatus(soId, 'fulfilled');
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
      try { await ImsSalesOrdersRepo.changeStatus(existing[0].id, 'cancelled'); } catch {}
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
      try { await ImsSalesOrdersRepo.changeStatus(existing[0].id, 'fulfilled'); } catch {}
    }
  }

  return respond();
}
