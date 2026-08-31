import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { LoyaltyRepository } from '@/lib/ims/LoyaltyRepository';
import { calculateEarnedPoints, parseLoyaltySettings } from '@/lib/loyalty/calculations';
import { LOYALTY_SETTING_KEYS } from '@/lib/loyalty/types';
import { getOrCreateOnlineShopCustomer } from '@/lib/onlineShop/onlineShopIdentity';
import { allocateCentsProportionally } from '@/lib/onlineShop/onlineShopValueAllocation';
import { getIMSPool } from '@/services/IMSMySQLService';

interface CheckoutRow {
  checkout_id: string; status: string; fulfilment_mode: 'single_location' | 'consolidate' | 'split'; fulfilment_type: string;
  location_id: number; shipping_address_json: unknown; subtotal_cents: number; tax_cents: number; shipping_cents: number;
  loyalty_cents: number; store_credit_cents: number; total_cents: number; currency_code: string; completed_so_id: number | null;
}
interface CheckoutItemRow { variant_id: string; quantity: number; unit_price_cents: number; tax_cents: number; line_total_cents: number }
interface ReservationRow { id: number; variant_id: string; location_id: number; quantity: number; status: string }
interface GroupRow { id: number; location_id: number; completed_so_id: number | null }
interface ValueReservationRow {
  id: number; contact_id: number; value_type: 'loyalty' | 'store_credit'; reward_id: number | null;
  points: number | null; amount_cents: number; status: string;
}

function parseAddress(value: unknown): Record<string, string> {
  if (value && typeof value === 'object') return value as Record<string, string>;
  try { const parsed = JSON.parse(String(value ?? '{}')); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch { return {}; }
}

function nativeOrderNumber(checkoutId: string, locationId: number): string {
  return `NS-${checkoutId.replace(/-/g, '').slice(0, 12).toUpperCase()}-${locationId}`;
}

function nativeTransferNumber(checkoutId: string, sourceLocationId: number): string {
  return `NT-${checkoutId.replace(/-/g, '').slice(0, 12).toUpperCase()}-${sourceLocationId}`;
}

async function finalizeInTenant(input: { businessId: string; checkoutId: string; provider: 'stripe' | 'account_value'; providerPaymentId: string; amountCents: number }): Promise<number[]> {
  const checkoutIdentityConnection = await getIMSPool().getConnection();
  let checkoutEmail = '';
  let reservedContactId: number | null = null;
  try {
    const [rows] = await checkoutIdentityConnection.execute<any[]>('SELECT guest_email FROM ims_online_shop_checkouts WHERE business_id = ? AND checkout_id = ? LIMIT 1', [input.businessId, input.checkoutId]);
    checkoutEmail = String(rows[0]?.guest_email ?? '');
    const [valueRows] = await checkoutIdentityConnection.execute<any[]>(
      `SELECT contact_id FROM ims_online_shop_value_reservations
        WHERE business_id = ? AND checkout_id = ? AND status = 'active' LIMIT 1`,
      [input.businessId, input.checkoutId],
    );
    reservedContactId = valueRows[0] ? Number(valueRows[0].contact_id) : null;
  } finally { checkoutIdentityConnection.release(); }
  const customerId = reservedContactId ?? (await getOrCreateOnlineShopCustomer(input.businessId, checkoutEmail)).contactId;
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const [checkoutRows] = await connection.execute<any[]>(
      `SELECT checkout_id, status, fulfilment_mode, fulfilment_type, location_id, shipping_address_json,
              subtotal_cents, tax_cents, shipping_cents, loyalty_cents, store_credit_cents,
              total_cents, currency_code, completed_so_id
         FROM ims_online_shop_checkouts WHERE business_id = ? AND checkout_id = ? LIMIT 1 FOR UPDATE`,
      [input.businessId, input.checkoutId],
    );
    const checkout = checkoutRows[0] as CheckoutRow | undefined;
    if (!checkout) throw new Error('Paid checkout was not found.');
    const [existingGroups] = await connection.execute<any[]>(
      'SELECT id, location_id, completed_so_id FROM ims_online_shop_fulfilment_groups WHERE business_id = ? AND checkout_id = ? ORDER BY id FOR UPDATE',
      [input.businessId, input.checkoutId],
    );
    if (checkout.status === 'completed' && existingGroups.every(group => group.completed_so_id)) {
      await connection.commit();
      return existingGroups.map(group => Number(group.completed_so_id));
    }
    if (!['open', 'payment_pending'].includes(checkout.status)) throw new Error(`Checkout cannot be finalized from status ${checkout.status}.`);
    if (Number(checkout.total_cents) !== input.amountCents || checkout.currency_code !== 'AUD') throw new Error('Stripe payment does not match the checkout total.');
    const [attemptRows] = await connection.execute<any[]>(
      `SELECT id, amount_cents FROM ims_online_shop_payment_attempts
        WHERE business_id = ? AND checkout_id = ? AND provider = ? AND provider_payment_id = ? LIMIT 1 FOR UPDATE`,
      [input.businessId, input.checkoutId, input.provider, input.providerPaymentId],
    );
    if (!attemptRows[0] || Number(attemptRows[0].amount_cents) !== input.amountCents) throw new Error('Payment attempt does not match this checkout.');
    const [itemRows] = await connection.execute<any[]>(
      `SELECT item.variant_id, item.quantity, item.unit_price_cents, item.tax_cents, item.line_total_cents,
              COALESCE(product.is_stock_item, 1) AS is_stock_item
         FROM ims_online_shop_checkout_items item
         JOIN ims_product_variants variant ON variant.business_id = item.business_id AND variant.variant_id = item.variant_id
         JOIN ims_products product ON product.business_id = variant.business_id AND product.product_id = variant.product_id
        WHERE item.business_id = ? AND item.checkout_id = ? ORDER BY item.id FOR UPDATE`,
      [input.businessId, input.checkoutId],
    );
    const items = itemRows as CheckoutItemRow[];
    const [reservationRows] = await connection.execute<any[]>(
      `SELECT id, variant_id, location_id, quantity, status FROM ims_online_shop_stock_reservations
        WHERE business_id = ? AND checkout_id = ? ORDER BY id FOR UPDATE`, [input.businessId, input.checkoutId],
    );
    const reservations = reservationRows as ReservationRow[];
    const trackedItems = items.filter(item => Number((item as any).is_stock_item ?? 1) === 1);
    const trackedReservationsMatch = trackedItems.every(item => reservations
      .filter(reservation => reservation.variant_id === item.variant_id)
      .reduce((sum, reservation) => sum + Number(reservation.quantity), 0) === Number(item.quantity));
    if (!items.length || reservations.some(reservation => reservation.status !== 'active') || !trackedReservationsMatch) {
      throw new Error('Paid checkout stock reservations are no longer available.');
    }
    const groups = existingGroups as GroupRow[];
    if (!groups.length) throw new Error('Paid checkout has no fulfilment groups.');
    const [pendingValueRows] = await connection.execute<any[]>(
      `SELECT id, contact_id, value_type, reward_id, points, amount_cents, status
         FROM ims_online_shop_value_reservations
        WHERE business_id = ? AND checkout_id = ? AND status = 'active'`,
      [input.businessId, input.checkoutId],
    );
    const pendingValues = pendingValueRows as ValueReservationRow[];
    if (pendingValues.some(row => Number(row.contact_id) !== customerId)) throw new Error('Checkout value reservations have inconsistent ownership.');
    const loyaltyReservation = pendingValues.find(row => row.value_type === 'loyalty');
    const storeCreditReservation = pendingValues.find(row => row.value_type === 'store_credit');
    if (Number(loyaltyReservation?.amount_cents ?? 0) !== Number(checkout.loyalty_cents)
      || Number(storeCreditReservation?.amount_cents ?? 0) !== Number(checkout.store_credit_cents)) {
      throw new Error('Checkout value reservations do not match the paid total.');
    }

    let loyaltyRedemptionId: number | null = null;
    if (loyaltyReservation) {
      const redemption = await LoyaltyRepository.reserveReward(connection, {
        businessId: input.businessId,
        contactId: customerId,
        rewardId: Number(loyaltyReservation.reward_id),
        idempotencyKey: `native-checkout:${input.checkoutId}:loyalty-redemption`,
        channel: 'native_shop',
      });
      if (Math.round(redemption.rewardValueAud * 100) !== Number(loyaltyReservation.amount_cents)) {
        throw new Error('The reserved loyalty reward value has changed.');
      }
      loyaltyRedemptionId = redemption.redemptionId;
      await connection.execute(
        `UPDATE loyalty_redemptions SET status = 'used', used_at = COALESCE(used_at, UTC_TIMESTAMP())
          WHERE business_id = ? AND id = ?`,
        [input.businessId, loyaltyRedemptionId],
      );
    }

    let storeCreditTransactionId: number | null = null;
    if (storeCreditReservation) {
      const storeCreditAmount = Number(storeCreditReservation.amount_cents) / 100;
      const storeCreditKey = `native-checkout:${input.checkoutId}:store-credit-redemption`;
      const [existingStoreCreditRows] = await connection.execute<any[]>(
        'SELECT id, contact_id, amount FROM store_credit_transactions WHERE idempotency_key = ? LIMIT 1 FOR UPDATE',
        [storeCreditKey],
      );
      if (existingStoreCreditRows[0]) {
        if (Number(existingStoreCreditRows[0].contact_id) !== customerId || Number(existingStoreCreditRows[0].amount) !== storeCreditAmount) {
          throw new Error('Store-credit redemption idempotency key was already used for different value.');
        }
        storeCreditTransactionId = Number(existingStoreCreditRows[0].id);
      } else {
        const [contactRows] = await connection.execute<any[]>(
          'SELECT store_credit FROM ims_contacts WHERE business_id = ? AND id = ? LIMIT 1 FOR UPDATE',
          [input.businessId, customerId],
        );
        const currentBalance = Number(contactRows[0]?.store_credit ?? -1);
        if (currentBalance < storeCreditAmount) throw new Error('Reserved store credit is no longer available.');
        const balanceAfter = Math.round((currentBalance - storeCreditAmount) * 100) / 100;
        await connection.execute('UPDATE ims_contacts SET store_credit = ? WHERE business_id = ? AND id = ?',
          [balanceAfter, input.businessId, customerId]);
        const [storeCreditResult] = await connection.execute<any>(
          `INSERT INTO store_credit_transactions
             (contact_id, type, amount, balance_after, idempotency_key, notes)
           VALUES (?, 'redeem', ?, ?, ?, ?)`,
          [customerId, storeCreditAmount, balanceAfter, storeCreditKey, `Native online checkout ${input.checkoutId}`],
        );
        storeCreditTransactionId = Number(storeCreditResult.insertId);
      }
    }
    const address = parseAddress(checkout.shipping_address_json);
    const soIds: number[] = [];

    const groupPlans = groups.map((group, groupIndex) => {
      const groupQuantities = new Map<string, number>();
      if (checkout.fulfilment_mode === 'consolidate') {
        for (const item of items) groupQuantities.set(item.variant_id, Number(item.quantity));
      } else {
        for (const reservation of reservations.filter(row => Number(row.location_id) === Number(group.location_id))) {
          groupQuantities.set(reservation.variant_id, (groupQuantities.get(reservation.variant_id) ?? 0) + Number(reservation.quantity));
        }
        if (groupIndex === 0) {
          for (const item of items.filter(item => Number((item as any).is_stock_item ?? 1) === 0)) {
            groupQuantities.set(item.variant_id, Number(item.quantity));
          }
        }
      }
      const groupItems = items.flatMap(item => {
        const quantity = groupQuantities.get(item.variant_id) ?? 0;
        return quantity > 0 ? [{ ...item, quantity, lineTotalCents: quantity * Number(item.unit_price_cents) }] : [];
      });
      if (!groupItems.length) throw new Error(`Fulfilment group ${group.location_id} has no reserved items.`);
      const shippingCents = groupIndex === 0 ? Number(checkout.shipping_cents) : 0;
      const merchandiseCents = groupItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
      return { group, groupItems, shippingCents, merchandiseCents, grossCents: merchandiseCents + shippingCents };
    });
    const loyaltyByGroup = allocateCentsProportionally(Number(checkout.loyalty_cents), groupPlans.map(plan => plan.merchandiseCents));
    const orderTotals = groupPlans.map((plan, index) => plan.grossCents - loyaltyByGroup[index]);
    const storeCreditByGroup = allocateCentsProportionally(Number(checkout.store_credit_cents), orderTotals);

    for (const [groupIndex, plan] of groupPlans.entries()) {
      const { group, groupItems, shippingCents, merchandiseCents } = plan;
      const loyaltyCents = loyaltyByGroup[groupIndex];
      const storeCreditCents = storeCreditByGroup[groupIndex];
      const orderTotalCents = orderTotals[groupIndex];
      const stripeCents = orderTotalCents - storeCreditCents;
      const taxCents = Math.round(orderTotalCents - orderTotalCents / 1.1);
      const orderNumber = nativeOrderNumber(checkout.checkout_id, Number(group.location_id));
      const paymentGateway = stripeCents > 0 && storeCreditCents > 0 ? 'Stripe + Store Credit'
        : storeCreditCents > 0 ? 'Store Credit' : 'Stripe';
      const [orderResult] = await connection.execute<any>(
        `INSERT INTO ims_sales_orders
           (business_id, so_number, customer_id, price_tier, so_type, sales_channel, native_checkout_id, location_id,
            status, order_date, delivery_address, delivery_address2, delivery_suburb, delivery_city, delivery_state,
            delivery_postcode, delivery_country, tax_treatment, freight, discount, subtotal, tax_amount, total_amount,
            currency_code, payment_gateway, financial_status, notes)
         VALUES (?, ?, ?, 'retail', 'online', 'native_shop', ?, ?, 'confirmed', UTC_DATE(), ?, ?, ?, ?, ?, ?, ?,
           'inc_tax', ?, ?, ?, ?, ?, 'AUD', ?, 'paid', ?)`,
        [input.businessId, orderNumber, customerId, checkout.checkout_id, group.location_id,
          address.address || null, address.address2 || null, address.suburb || null, address.city || null,
          address.state || null, address.postcode || null, address.country || null, shippingCents / 100,
          loyaltyCents / 100, merchandiseCents / 100, taxCents / 100, orderTotalCents / 100, paymentGateway,
          `Native online checkout ${checkout.checkout_id}`],
      );
      const soId = Number(orderResult.insertId); soIds.push(soId);
      for (const item of groupItems) {
        await connection.execute(
          `INSERT INTO ims_sales_order_items
             (business_id, so_id, variant_id, qty_ordered, qty_fulfilled, unit_price, discount_pct, tax_rate, line_total, notes)
           VALUES (?, ?, ?, ?, 0, ?, 0, 0.1, ?, 'Native online shop')`,
          [input.businessId, soId, item.variant_id, item.quantity, Number(item.unit_price_cents) / 100, item.lineTotalCents / 100],
        );
        if (Number((item as any).is_stock_item ?? 1) === 1) {
          await connection.execute(
            `INSERT INTO ims_stock (business_id, variant_id, location_id, qty_committed)
             VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE qty_committed = qty_committed + VALUES(qty_committed)`,
            [input.businessId, item.variant_id, group.location_id, item.quantity],
          );
        }
      }
      if (stripeCents > 0) {
        await connection.execute(
          `INSERT INTO ims_sales_order_payments
             (business_id, so_id, payment_date, amount, currency_code, exchange_rate, amount_local, notes, xero_post_intent)
           VALUES (?, ?, UTC_DATE(), ?, 'AUD', 1, ?, ?, 'solvantis_only')`,
          [input.businessId, soId, stripeCents / 100, stripeCents / 100, `Native Stripe ${input.providerPaymentId}`],
        );
      }
      if (storeCreditCents > 0) {
        await connection.execute(
          `INSERT INTO ims_sales_order_payments
             (business_id, so_id, payment_date, amount, currency_code, exchange_rate, amount_local, notes, xero_post_intent)
           VALUES (?, ?, UTC_DATE(), ?, 'AUD', 1, ?, ?, 'solvantis_only')`,
          [input.businessId, soId, storeCreditCents / 100, storeCreditCents / 100,
            `Native Store Credit ${storeCreditTransactionId}`],
        );
      }
      await connection.execute(
        'UPDATE ims_online_shop_fulfilment_groups SET completed_so_id = ?, completed_at = UTC_TIMESTAMP() WHERE id = ? AND business_id = ?',
        [soId, group.id, input.businessId],
      );
      await connection.execute(
        `UPDATE ims_online_shop_stock_reservations SET status = 'converted', converted_so_id = ?
          WHERE business_id = ? AND checkout_id = ? AND status = 'active' ${checkout.fulfilment_mode === 'split' ? 'AND location_id = ?' : ''}`,
        checkout.fulfilment_mode === 'split' ? [soId, input.businessId, input.checkoutId, group.location_id] : [soId, input.businessId, input.checkoutId],
      );
    }

    if (checkout.fulfilment_mode === 'consolidate') {
      const sourceGroups = new Map<number, ReservationRow[]>();
      for (const reservation of reservations.filter(row => Number(row.location_id) !== Number(checkout.location_id))) {
        const list = sourceGroups.get(Number(reservation.location_id)) ?? []; list.push(reservation); sourceGroups.set(Number(reservation.location_id), list);
      }
      for (const [sourceLocationId, sourceReservations] of sourceGroups) {
        const transferNumber = nativeTransferNumber(checkout.checkout_id, sourceLocationId);
        const [transferResult] = await connection.execute<any>(
          `INSERT INTO ims_branch_transfers
             (business_id, transfer_number, from_location_id, to_location_id, status, transfer_date, notes, total_value)
           VALUES (?, ?, ?, ?, 'sent', UTC_DATE(), ?, 0)`,
          [input.businessId, transferNumber, sourceLocationId, checkout.location_id, `Native checkout ${checkout.checkout_id}`],
        );
        for (const reservation of sourceReservations) {
          const [costRows] = await connection.execute<any[]>('SELECT COALESCE(avg_cost, cost_aud, cost, 0) AS unit_cost FROM ims_product_variants WHERE business_id = ? AND variant_id = ? LIMIT 1', [input.businessId, reservation.variant_id]);
          const unitCost = Number(costRows[0]?.unit_cost) || 0;
          await connection.execute(
            `INSERT INTO ims_branch_transfer_items (transfer_id, variant_id, qty_sent, unit_cost, line_value, notes)
             VALUES (?, ?, ?, ?, ?, 'Native online consolidation')`,
            [Number(transferResult.insertId), reservation.variant_id, reservation.quantity, unitCost, unitCost * reservation.quantity],
          );
          await connection.execute(
            `INSERT INTO ims_stock (business_id, variant_id, location_id, qty_committed) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE qty_committed = qty_committed + VALUES(qty_committed)`,
            [input.businessId, reservation.variant_id, sourceLocationId, reservation.quantity],
          );
        }
      }
    }
    const [loyaltySettingRows] = await connection.execute<any[]>(
      `SELECT \`key\`, value FROM ims_settings
        WHERE business_id = ? AND \`key\` IN (?, ?, ?)`,
      [input.businessId, LOYALTY_SETTING_KEYS.enabled, LOYALTY_SETTING_KEYS.earnRate, LOYALTY_SETTING_KEYS.startedAt],
    );
    const loyaltySettings = parseLoyaltySettings(Object.fromEntries(loyaltySettingRows.map(row => [String(row.key), String(row.value ?? '')])));
    const today = new Date().toISOString().slice(0, 10);
    if (loyaltySettings.enabled && (!loyaltySettings.startedAt || today >= loyaltySettings.startedAt)) {
      const points = calculateEarnedPoints({
        merchandiseTotal: Number(checkout.subtotal_cents) / 100,
        loyaltyDiscountTotal: Number(checkout.loyalty_cents) / 100,
        earnRate: loyaltySettings.earnRate,
      });
      if (points > 0) {
        const [memberRows] = await connection.execute<any[]>(
          `SELECT id FROM ims_contacts WHERE business_id = ? AND id = ? AND is_active = 1 AND loyalty_member = 1
            AND type IN ('retail_customer','b2b_customer','both') LIMIT 1`,
          [input.businessId, customerId],
        );
        if (memberRows[0]) {
          await LoyaltyRepository.applyTransaction(connection, {
            businessId: input.businessId,
            contactId: customerId,
            type: 'earn',
            pointsDelta: points,
            eligibleSpendCents: Math.max(0, Number(checkout.subtotal_cents) - Number(checkout.loyalty_cents)),
            channel: 'native_shop',
            sourceType: 'native_checkout',
            sourceId: input.checkoutId,
            idempotencyKey: `native-checkout:${input.checkoutId}:earn`,
          });
        }
      }
    }
    await connection.execute(
      `UPDATE ims_online_shop_payment_attempts SET status = 'succeeded', updated_at = CURRENT_TIMESTAMP
        WHERE business_id = ? AND checkout_id = ? AND provider = ? AND provider_payment_id = ?`,
      [input.businessId, input.checkoutId, input.provider, input.providerPaymentId],
    );
    await connection.execute(
      `UPDATE ims_online_shop_value_reservations
          SET status = 'finalized', loyalty_redemption_id = CASE WHEN value_type = 'loyalty' THEN ? ELSE loyalty_redemption_id END,
              finalized_at = UTC_TIMESTAMP()
        WHERE business_id = ? AND checkout_id = ? AND status = 'active'`,
      [loyaltyRedemptionId, input.businessId, input.checkoutId],
    );
    await connection.execute(
      `UPDATE ims_online_shop_checkouts SET status = 'completed', completed_so_id = ?, completed_at = UTC_TIMESTAMP()
        WHERE business_id = ? AND checkout_id = ?`, [soIds[0], input.businessId, input.checkoutId],
    );
    await connection.commit();
    return soIds;
  } catch (error) {
    await connection.rollback(); throw error;
  } finally { connection.release(); }
}

export const OnlineShopOrderFinalizer = {
  finalizePaid(input: { businessId: string; checkoutId: string; providerPaymentId: string; amountCents: number; provider?: 'stripe' | 'account_value' }): Promise<number[]> {
    return runImsForBusiness(input.businessId, () => finalizeInTenant({ ...input, provider: input.provider ?? 'stripe' }));
  },
};