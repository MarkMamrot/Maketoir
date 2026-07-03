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
import { cookies } from 'next/headers';
import { imsQuery, imsExecute, getIMSPool } from '@/services/IMSMySQLService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ShopifyService } from '@/services/ShopifyService';
import { ImsSalesOrdersRepo } from '@/lib/ims/ImsRepository';
import { decrypt } from '@/lib/encryption';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

async function getSetting(businessId: string, key: string): Promise<string | null> {
  const rows = await imsQuery<{ value: string }>(
    'SELECT `value` FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1',
    [businessId, key],
  );
  return rows[0]?.value ?? null;
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const businessId: string = session.businessId ?? '';

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

  // Shopify credentials
  const conn = await ConnectionsRepository.get(businessId);
  const shopId    = (conn as any)?.shopify_shop_id;
  let   shopToken = (conn as any)?.shopify_access_token ?? '';
  if (!shopId || !shopToken) {
    return NextResponse.json({ error: 'Shopify credentials not configured.' }, { status: 400 });
  }
  try { shopToken = decrypt(shopToken); } catch { /* unencrypted */ }

  // Fetch orders from Shopify
  const shopify = new ShopifyService(shopId, shopToken);
  let shopifyOrders: any[];
  try {
    shopifyOrders = await shopify.getAllOrders(syncFrom);
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

  // Existing shopify_order_ids to avoid duplicates
  const existingRows = await imsQuery<{ shopify_order_id: string }>(
    `SELECT shopify_order_id FROM ims_sales_orders
     WHERE business_id = ? AND shopify_order_id IS NOT NULL`,
    [businessId],
  );
  const existingIds = new Set(existingRows.map(r => String(r.shopify_order_id)));

  let imported = 0;
  let skippedExisting = 0;
  let skippedNoItems = 0;
  const errors: string[] = [];

  for (const order of shopifyOrders) {
    const orderIdStr = String(order.id);

    // Skip if already imported
    if (existingIds.has(orderIdStr)) { skippedExisting++; continue; }

    // Map line items to IMS variants
    const items: { variant_id: string; qty_ordered: number; unit_price: number; tax_rate: number; notes: string }[] = [];
    for (const li of order.line_items ?? []) {
      const imsVariantId = shopifyToIms.get(String(li.variant_id ?? ''));
      if (!imsVariantId) continue;
      items.push({
        variant_id:  imsVariantId,
        qty_ordered: Number(li.quantity ?? 1),
        unit_price:  parseFloat(li.price ?? '0'),
        tax_rate:    0.1, // Australian GST — prices from Shopify are usually inc-tax; we'll treat as ex-tax for simplicity
        notes:       li.name ?? '',
      });
    }

    if (items.length === 0) { skippedNoItems++; continue; }

    const orderDate = (order.created_at ?? new Date().toISOString()).slice(0, 10);
    const freight   = parseFloat(order.total_shipping_price_set?.shop_money?.amount ?? '0');
    const discount  = parseFloat(order.total_discounts ?? '0');

    try {
      // Create as draft first (ImsSalesOrdersRepo.create doesn't set so_type)
      const pool = await getIMSPool();
      const poolConn = await pool.getConnection();
      let soId: number;
      try {
        const soNumber = `ONL-${orderDate.replace(/-/g, '')}-${orderIdStr.slice(-6)}`;
        const [result] = await poolConn.execute<any>(
          `INSERT INTO ims_sales_orders
             (business_id, so_number, so_type, location_id, status, order_date, freight, discount,
              subtotal, tax_amount, total_amount, shopify_order_id, notes)
           VALUES (?, ?, 'online', ?, 'draft', ?, ?, ?,
             (SELECT IFNULL(SUM(qty * price), 0) FROM (SELECT ? AS dummy) t),
             0, ?, ?, ?)`,
          [
            businessId, soNumber, locationId, orderDate, freight, discount,
            0, // subtotal placeholder
            parseFloat(order.total_price ?? '0'),
            orderIdStr,
            `Shopify order ${order.name ?? ''}`.trim(),
          ],
        );

        // Recalculate subtotal from items
        let subtotal = 0;
        for (const it of items) subtotal += it.qty_ordered * it.unit_price * (1 - 0);
        const taxAmount = subtotal * 0.1;
        soId = result.insertId;

        // Fix subtotal/tax
        await poolConn.execute(
          'UPDATE ims_sales_orders SET subtotal = ?, tax_amount = ? WHERE id = ?',
          [subtotal, taxAmount, soId],
        );

        // Insert line items
        for (const it of items) {
          const lineTotal = it.qty_ordered * it.unit_price;
          await poolConn.execute(
            `INSERT INTO ims_sales_order_items
               (so_id, variant_id, qty_ordered, qty_fulfilled, unit_price, discount_pct, tax_rate, line_total, notes)
             VALUES (?, ?, ?, 0, ?, 0, ?, ?, ?)`,
            [soId, it.variant_id, it.qty_ordered, it.unit_price, it.tax_rate, lineTotal, it.notes],
          );
        }
      } finally {
        poolConn.release();
      }

      // Transition draft → confirmed (commits qty_committed)
      await ImsSalesOrdersRepo.changeStatus(soId, 'confirmed');

      // If already fulfilled on Shopify → move stock now
      if (order.fulfillment_status === 'fulfilled') {
        await ImsSalesOrdersRepo.changeStatus(soId, 'fulfilled');
      }

      // If cancelled on Shopify → cancel it
      if (order.financial_status === 'voided' || order.cancelled_at) {
        await ImsSalesOrdersRepo.changeStatus(soId, 'cancelled');
      }

      imported++;
    } catch (e: any) {
      errors.push(`Order ${order.name}: ${e.message}`);
    }
  }

  return NextResponse.json({
    success: true,
    total_from_shopify: shopifyOrders.length,
    imported,
    skipped_existing: skippedExisting,
    skipped_no_items: skippedNoItems,
    errors: errors.slice(0, 20),
  });
}
