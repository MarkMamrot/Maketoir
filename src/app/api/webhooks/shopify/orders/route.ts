/**
 * POST /api/webhooks/shopify/orders
 *
 * Shopify webhook receiver for real-time order events.
 * Handles: orders/create, orders/cancelled, fulfillments/create
 *
 * Setup in Shopify Admin → Settings → Notifications → Webhooks:
 *   orders/creation    → https://your-domain/api/webhooks/shopify/orders
 *   orders/cancelled   → https://your-domain/api/webhooks/shopify/orders
 *   fulfillments/creation → https://your-domain/api/webhooks/shopify/orders
 *
 * The webhook signing secret is stored in ims_settings as 'shopify_webhook_secret'.
 */
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { imsQuery, imsExecute, getIMSPool } from '@/services/IMSMySQLService';
import { ImsSalesOrdersRepo } from '@/lib/ims/ImsRepository';
import { toBusinessDate } from '@/lib/shopifyDate';

export const runtime = 'nodejs';

async function getSettingsForBusiness(): Promise<{ businessId: string; secret: string; syncFrom: string; locationId: number } | null> {
  // Find business by shopify_webhook_secret — the webhook doesn't carry businessId
  // We store the secret in ims_settings, so we need to look it up by secret value
  const rows = await imsQuery<{ business_id: string; value: string }>(
    `SELECT business_id, value FROM ims_settings WHERE \`key\` = 'shopify_webhook_secret' AND value IS NOT NULL AND value != ''`,
    [],
  );
  if (!rows.length) return null;

  // We'll return the first match — in a multi-tenant setup this should be improved
  // by including businessId in the webhook URL path
  const businessId = rows[0].business_id;
  const secret     = rows[0].value;

  const syncFromRow = await imsQuery<{ value: string }>(
    `SELECT value FROM ims_settings WHERE business_id = ? AND \`key\` = 'shopify_order_sync_from' LIMIT 1`,
    [businessId],
  );
  const syncFrom = syncFromRow[0]?.value ?? '2026-07-01';

  const locRow = await imsQuery<{ value: string }>(
    `SELECT value FROM ims_settings WHERE business_id = ? AND \`key\` = 'online_sales_location_id' LIMIT 1`,
    [businessId],
  );
  const locationId = Number(locRow[0]?.value ?? 0);

  return { businessId, secret, syncFrom, locationId };
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const topic   = req.headers.get('x-shopify-topic') ?? '';
  const hmac    = req.headers.get('x-shopify-hmac-sha256') ?? '';

  const config = await getSettingsForBusiness();
  if (!config) {
    // No webhook secret configured — accept silently (avoids Shopify disabling the webhook)
    return NextResponse.json({ ok: true });
  }

  // Check sync is enabled (always return 200 to avoid Shopify deactivating the webhook)
  const enabledRow = await imsQuery<{ value: string }>(
    `SELECT value FROM ims_settings WHERE business_id = ? AND \`key\` = 'shopify_order_sync_enabled' LIMIT 1`,
    [config.businessId],
  );
  if (enabledRow[0]?.value !== '1') return NextResponse.json({ ok: true });

  // Verify HMAC (timingSafeEqual throws on length mismatch — guard first)
  const computed = crypto.createHmac('sha256', config.secret).update(rawBody, 'utf8').digest('base64');
  let valid = false;
  try {
    const a = Buffer.from(computed);
    const b = Buffer.from(hmac);
    valid = hmac.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { valid = false; }
  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Return 200 immediately (Shopify times out after 5s)
  const respond = () => NextResponse.json({ ok: true });

  // ── orders/create ────────────────────────────────────────────────────────────
  if (topic === 'orders/create' || topic === 'orders/paid') {
    // Business-timezone (AEST) date — matches how the admin entered the transition date.
    const orderDate = toBusinessDate(payload.created_at);

    // Skip orders before transition date
    if (orderDate < config.syncFrom) return respond();

    const orderIdStr = String(payload.id ?? '');

    // Skip if already imported
    const existing = await imsQuery<{ id: number }>(
      `SELECT id FROM ims_sales_orders WHERE shopify_order_id = ? LIMIT 1`,
      [orderIdStr],
    );
    if (existing.length > 0) return respond();

    if (!config.locationId) return respond(); // no location configured

    // Map line items
    const variantRows = await imsQuery<{ variant_id: string; shopify_variant_id: string }>(
      `SELECT v.variant_id, v.shopify_variant_id
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE p.business_id = ? AND v.shopify_variant_id IS NOT NULL`,
      [config.businessId],
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
        const soNumber = `ONL-${orderDate.replace(/-/g, '')}-${orderIdStr.slice(-6)}`;
        // Shopify money fields are authoritative; prices are GST-inclusive (AU) so
        // total_tax is the real GST, not subtotal × 0.1.
        const subtotal = parseFloat(payload.subtotal_price ?? '0');
        const taxAmount = parseFloat(payload.total_tax ?? '0');
        const freight  = parseFloat(payload.total_shipping_price_set?.shop_money?.amount ?? '0');
        const discount = parseFloat(payload.total_discounts ?? '0');
        const [r] = await conn.execute<any>(
          `INSERT INTO ims_sales_orders
             (business_id, so_number, so_type, location_id, status, order_date, freight, discount,
              subtotal, tax_amount, total_amount, shopify_order_id, notes)
           VALUES (?, ?, 'online', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [config.businessId, soNumber, config.locationId, orderDate, freight, discount,
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
      `SELECT id, status FROM ims_sales_orders WHERE shopify_order_id = ? LIMIT 1`,
      [orderIdStr],
    );
    if (existing.length && existing[0].status !== 'cancelled') {
      try { await ImsSalesOrdersRepo.changeStatus(existing[0].id, 'cancelled'); } catch {}
    }
  }

  // ── fulfillments/create ───────────────────────────────────────────────────────
  if (topic === 'fulfillments/create' || topic === 'orders/fulfilled') {
    const orderId    = String(payload.order_id ?? payload.id ?? '');
    const existing   = await imsQuery<{ id: number; status: string }>(
      `SELECT id, status FROM ims_sales_orders WHERE shopify_order_id = ? LIMIT 1`,
      [orderId],
    );
    if (existing.length && existing[0].status === 'confirmed') {
      try { await ImsSalesOrdersRepo.changeStatus(existing[0].id, 'fulfilled'); } catch {}
    }
  }

  return respond();
}
