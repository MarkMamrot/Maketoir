import { randomUUID } from 'crypto';
import type { PoolConnection } from 'mysql2/promise';

import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { allocateOnlineShopCart, OnlineShopStockConflict, type OnlineShopLocationStock } from '@/lib/onlineShop/fulfilmentAllocation';
import { parseOnlineShopFulfilmentSettings } from '@/lib/onlineShop/onlineShopFulfilmentSettings';
import { normalizeAustralianShippingAddress, quoteOnlineShopShipping, type OnlineShopShippingRule } from '@/lib/onlineShop/shippingRules';
import { normalizeStorefrontCart } from '@/lib/storefront/commerce';
import { getIMSPool } from '@/services/IMSMySQLService';

interface CheckoutVariantRow {
  variant_id: string;
  product_name: string;
  variant_label: string | null;
  sku: string | null;
  retail_price: number | string;
}

interface StockRow {
  variant_id: string;
  location_id: number;
  qty_on_hand: number | string;
  qty_committed: number | string;
}

interface ReservationRow {
  variant_id: string;
  location_id: number;
  quantity: number | string;
}

export interface OnlineShopCheckoutSummary {
  checkoutId: string;
  status: 'open';
  fulfilmentType: 'pickup' | 'delivery';
  locationId: number;
  expiresAt: string;
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  currencyCode: 'AUD';
}

type CreateCheckoutInput = { businessId: string; guestEmail: string; cart: unknown } & (
  | { fulfilmentType: 'pickup'; pickupLocationId: number }
  | { fulfilmentType: 'delivery'; shippingRuleId: number; shippingAddress: unknown }
);

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(',');
}

async function loadPickupLocation(connection: PoolConnection, businessId: string, locationId: number): Promise<{ id: number; name: string } | null> {
  const [rows] = await connection.execute<any[]>(
    `SELECT l.id, COALESCE(NULLIF(p.display_name, ''), l.name) AS name
       FROM ims_online_shop_pickup_locations p
       JOIN ims_locations l ON l.id = p.location_id AND l.business_id = p.business_id
      WHERE p.business_id = ? AND p.location_id = ? AND p.is_active = 1
        AND l.is_active = 1 AND l.has_online = 1
      LIMIT 1 FOR UPDATE`,
    [businessId, locationId],
  );
  return rows[0] ?? null;
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  try { const parsed = JSON.parse(String(value ?? '[]')); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
}

async function createCheckoutInTransaction(input: CreateCheckoutInput): Promise<OnlineShopCheckoutSummary> {
  const cart = normalizeStorefrontCart(input.cart);
  if (!cart.lines.length) throw new Error('Your cart is empty.');
  const guestEmail = input.guestEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail) || guestEmail.length > 320) throw new Error('Enter a valid email address.');
  if (input.fulfilmentType === 'pickup' && (!Number.isSafeInteger(input.pickupLocationId) || input.pickupLocationId <= 0)) throw new Error('Choose a pickup location.');
  if (input.fulfilmentType === 'delivery' && (!Number.isSafeInteger(input.shippingRuleId) || input.shippingRuleId <= 0)) throw new Error('Choose a delivery option.');

  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    let fulfilmentMode: 'single_location' | 'consolidate' | 'split' = 'single_location';
    let dispatchLocationId: number | null = null;
    let shippingRuleId: number | null = null;
    let shippingAddress: ReturnType<typeof normalizeAustralianShippingAddress> | null = null;
    let shippingRule: OnlineShopShippingRule | null = null;
    let locationRows: Array<{ id: number; priority: number }> = [];
    if (input.fulfilmentType === 'pickup') {
      const pickupLocation = await loadPickupLocation(connection, input.businessId, input.pickupLocationId);
      if (!pickupLocation) throw new Error('The selected pickup location is unavailable.');
      dispatchLocationId = input.pickupLocationId;
      locationRows = [{ id: input.pickupLocationId, priority: 0 }];
    } else {
      shippingAddress = normalizeAustralianShippingAddress(input.shippingAddress);
      const [settingRows] = await connection.execute<any[]>(
        "SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` IN ('native_shop_fulfilment_mode','native_shop_dispatch_location_id','online_pick_priority') FOR UPDATE",
        [input.businessId],
      );
      const settings = Object.fromEntries(settingRows.map(row => [String(row.key), String(row.value ?? '')]));
      const parsedSettings = parseOnlineShopFulfilmentSettings(settings);
      fulfilmentMode = parsedSettings.mode;
      dispatchLocationId = parsedSettings.dispatchLocationId;
      const priority = parseStringList(settings.online_pick_priority).map(Number);
      const rank = new Map(priority.map((id, index) => [id, index]));
      const [onlineLocations] = await connection.execute<any[]>(
        'SELECT id FROM ims_locations WHERE business_id = ? AND is_active = 1 AND has_online = 1 ORDER BY id FOR UPDATE', [input.businessId],
      );
      locationRows = onlineLocations.map(row => ({ id: Number(row.id), priority: rank.get(Number(row.id)) ?? priority.length + Number(row.id) }));
      const [ruleRows] = await connection.execute<any[]>(
        `SELECT id, name, rule_type, amount_cents, free_over_cents, states_json, postcodes_json, sort_order
           FROM ims_online_shop_shipping_rules WHERE business_id = ? AND id = ? AND is_active = 1 LIMIT 1 FOR UPDATE`,
        [input.businessId, input.shippingRuleId],
      );
      const row = ruleRows[0];
      if (!row || row.rule_type !== 'flat') throw new Error('The selected delivery option is unavailable.');
      shippingRuleId = Number(row.id);
      shippingRule = { id: Number(row.id), name: String(row.name), ruleType: 'flat', amountCents: Number(row.amount_cents) || 0,
        freeOverCents: row.free_over_cents === null ? null : Number(row.free_over_cents), states: parseStringList(row.states_json).map(value => value.toUpperCase()),
        postcodes: parseStringList(row.postcodes_json), sortOrder: Number(row.sort_order) || 0 };
    }

    const variantIds = cart.lines.map(line => line.variantId);
    const [variantRows] = await connection.execute<CheckoutVariantRow[]>(
      `SELECT v.variant_id, p.name AS product_name, NULLIF(CONCAT_WS(' / ',
                NULLIF(v.option1_value, ''), NULLIF(v.option2_value, ''), NULLIF(v.option3_value, '')), '') AS variant_label,
              v.sku,
              CASE WHEN v.price_rrp_sale IS NOT NULL AND v.price_rrp_sale > 0
                AND (v.discount_start_date IS NULL OR v.discount_start_date <= CURRENT_DATE)
                AND (v.discount_end_date IS NULL OR v.discount_end_date >= CURRENT_DATE)
                THEN v.price_rrp_sale ELSE v.price_rrp END AS retail_price
         FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = v.business_id AND p.is_active = 1
         JOIN ims_online_shop_products pub ON pub.product_id = p.product_id AND pub.business_id = p.business_id AND pub.is_published = 1
        WHERE v.business_id = ? AND v.variant_id IN (${placeholders(variantIds)}) AND v.is_active = 1
        FOR UPDATE`,
      [input.businessId, ...variantIds],
    );
    const variants = new Map(variantRows.map(row => [row.variant_id, row]));
    if (variants.size !== variantIds.length) throw new OnlineShopStockConflict('One or more cart items are no longer available.');

    await connection.execute(
      `UPDATE ims_online_shop_stock_reservations
          SET status = 'expired', released_at = UTC_TIMESTAMP()
        WHERE business_id = ? AND status = 'active' AND expires_at <= UTC_TIMESTAMP()`,
      [input.businessId],
    );
    const locationIds = locationRows.map(location => location.id);
    if (!locationIds.length) throw new OnlineShopStockConflict('No online fulfilment locations are available.');
    const [stockRows] = await connection.execute<StockRow[]>(
      `SELECT s.variant_id, s.location_id, s.qty_on_hand, s.qty_committed
         FROM ims_stock s
        WHERE s.business_id = ? AND s.location_id IN (${placeholders(locationIds)}) AND s.variant_id IN (${placeholders(variantIds)})
        ORDER BY s.location_id, s.variant_id FOR UPDATE`,
      [input.businessId, ...locationIds, ...variantIds],
    );
    const [reservationRows] = await connection.execute<ReservationRow[]>(
      `SELECT variant_id, location_id, SUM(quantity) AS quantity
         FROM ims_online_shop_stock_reservations
        WHERE business_id = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP()
          AND location_id IN (${placeholders(locationIds)}) AND variant_id IN (${placeholders(variantIds)})
        GROUP BY variant_id, location_id FOR UPDATE`,
      [input.businessId, ...locationIds, ...variantIds],
    );
    const reserved = new Map(reservationRows.map(row => [`${row.location_id}:${row.variant_id}`, Number(row.quantity) || 0]));
    const stockByLocation = new Map(locationRows.map(location => [location.id, { locationId: location.id, priority: location.priority, availableByVariant: {} as Record<string, number> }]));
    for (const stock of stockRows) {
      stockByLocation.get(Number(stock.location_id))!.availableByVariant[stock.variant_id] = Math.max(0, Math.floor(Number(stock.qty_on_hand) - Number(stock.qty_committed)
        - (reserved.get(`${stock.location_id}:${stock.variant_id}`) ?? 0)));
    }
    const locationStock: OnlineShopLocationStock[] = [...stockByLocation.values()];
    const pricedLines = cart.lines.map(line => {
      const row = variants.get(line.variantId)!;
      const unitPriceCents = Math.round(Number(row.retail_price) * 100);
      if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0) throw new OnlineShopStockConflict(`${row.product_name} is not currently available for sale.`);
      return { variantId: line.variantId, quantity: line.quantity, unitPriceCents };
    });
    const plan = allocateOnlineShopCart({ mode: fulfilmentMode, lines: pricedLines, locations: locationStock, dispatchLocationId });
    const shippingOptions = shippingRule && shippingAddress
      ? quoteOnlineShopShipping({ address: shippingAddress, subtotalCents: plan.subtotalCents, rules: [shippingRule] }) : [];
    const shippingCents = input.fulfilmentType === 'delivery' ? shippingOptions[0]?.amountCents : 0;
    if (input.fulfilmentType === 'delivery' && shippingCents === undefined) throw new Error('The selected delivery option does not cover this address.');
    const checkoutId = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await connection.execute(
      `INSERT INTO ims_online_shop_checkouts
         (checkout_id, business_id, guest_email, status, fulfilment_mode, fulfilment_type, location_id, shipping_rule_id, shipping_address_json,
          subtotal_cents, tax_cents, shipping_cents, total_cents, currency_code, expires_at)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUD', ?)`,
      [checkoutId, input.businessId, guestEmail, fulfilmentMode, input.fulfilmentType, plan.dispatchLocationId, shippingRuleId,
        shippingAddress ? JSON.stringify(shippingAddress) : null, plan.subtotalCents, plan.taxCents, shippingCents,
        plan.subtotalCents + shippingCents, expiresAt],
    );
    for (const group of plan.fulfilmentGroups) {
      await connection.execute(
        `INSERT INTO ims_online_shop_fulfilment_groups (business_id, checkout_id, location_id) VALUES (?, ?, ?)`,
        [input.businessId, checkoutId, group.locationId],
      );
    }
    for (const line of pricedLines) {
      const row = variants.get(line.variantId)!;
      const lineTotalCents = line.quantity * line.unitPriceCents;
      const taxCents = Math.round(lineTotalCents - lineTotalCents / 1.1);
      await connection.execute(
        `INSERT INTO ims_online_shop_checkout_items
           (business_id, checkout_id, variant_id, quantity, unit_price_cents, tax_cents, line_total_cents, product_name, variant_label, sku)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.businessId, checkoutId, line.variantId, line.quantity, line.unitPriceCents, taxCents, lineTotalCents,
          row.product_name, row.variant_label, row.sku],
      );
    }
    for (const reservation of plan.reservations) {
      await connection.execute(
        `INSERT INTO ims_online_shop_stock_reservations
           (business_id, checkout_id, variant_id, location_id, quantity, status, expires_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        [input.businessId, checkoutId, reservation.variantId, reservation.locationId, reservation.quantity, expiresAt],
      );
    }
    await connection.commit();
    return { checkoutId, status: 'open', fulfilmentType: input.fulfilmentType, locationId: plan.dispatchLocationId,
      expiresAt: expiresAt.toISOString(), subtotalCents: plan.subtotalCents, taxCents: plan.taxCents,
      shippingCents, totalCents: plan.subtotalCents + shippingCents, currencyCode: 'AUD' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export const OnlineShopCheckoutRepository = {
  createPickup(input: { businessId: string; guestEmail: string; pickupLocationId: number; cart: unknown }): Promise<OnlineShopCheckoutSummary> {
    return runImsForBusiness(input.businessId, () => createCheckoutInTransaction({ ...input, fulfilmentType: 'pickup' }));
  },
  createDelivery(input: { businessId: string; guestEmail: string; shippingRuleId: number; shippingAddress: unknown; cart: unknown }): Promise<OnlineShopCheckoutSummary> {
    return runImsForBusiness(input.businessId, () => createCheckoutInTransaction({ ...input, fulfilmentType: 'delivery' }));
  },
};