import type { PoolConnection } from 'mysql2/promise';

import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { allocateOnlineShopValue } from '@/lib/onlineShop/onlineShopValueAllocation';
import { getIMSPool } from '@/services/IMSMySQLService';

interface CheckoutRow {
  checkout_id: string;
  guest_email: string;
  status: string;
  subtotal_cents: number;
  shipping_cents: number;
  expires_at: Date | string;
}

interface ContactRow {
  id: number;
  store_credit: number | string;
  loyalty_member: number;
}

interface RewardRow {
  id: number;
  display_name: string;
  description: string | null;
  points_cost: number;
  value_aud: number | string;
}

export interface OnlineShopValueQuote {
  checkoutId: string;
  grossTotalCents: number;
  loyaltyPoints: number;
  availableLoyaltyPoints: number;
  storeCreditBalanceCents: number;
  availableStoreCreditCents: number;
  loyaltyCents: number;
  storeCreditCents: number;
  payableCents: number;
  rewards: Array<{ id: number; name: string; description: string | null; pointsCost: number; valueCents: number; eligible: boolean }>;
}

function cents(value: number | string): number {
  return Math.max(0, Math.round(Number(value) * 100));
}

async function lockContext(
  connection: PoolConnection,
  input: { businessId: string; checkoutId: string; contactId: number; email: string },
) {
  const [checkoutRows] = await connection.execute<any[]>(
    `SELECT checkout_id, guest_email, status, subtotal_cents, shipping_cents, expires_at
       FROM ims_online_shop_checkouts
      WHERE business_id = ? AND checkout_id = ? AND status = 'open' AND expires_at > UTC_TIMESTAMP()
      LIMIT 1 FOR UPDATE`,
    [input.businessId, input.checkoutId],
  );
  const checkout = checkoutRows[0] as CheckoutRow | undefined;
  if (!checkout) throw new Error('Checkout has expired or is unavailable.');
  if (checkout.guest_email.trim().toLowerCase() !== input.email.trim().toLowerCase()) {
    throw new Error('This checkout does not belong to the signed-in customer.');
  }

  const [attemptRows] = await connection.execute<any[]>(
    'SELECT id FROM ims_online_shop_payment_attempts WHERE business_id = ? AND checkout_id = ? LIMIT 1 FOR UPDATE',
    [input.businessId, input.checkoutId],
  );
  if (attemptRows.length) throw new Error('Order value cannot be changed after payment has started.');

  const [contactRows] = await connection.execute<any[]>(
    `SELECT id, store_credit, loyalty_member FROM ims_contacts
      WHERE business_id = ? AND id = ? AND is_active = 1
        AND type IN ('retail_customer','b2b_customer','both') LIMIT 1 FOR UPDATE`,
    [input.businessId, input.contactId],
  );
  const contact = contactRows[0] as ContactRow | undefined;
  if (!contact) throw new Error('The signed-in customer is no longer available.');

  const [accountRows] = await connection.execute<any[]>(
    `SELECT balance_points FROM loyalty_accounts
      WHERE business_id = ? AND contact_id = ? AND status = 'active' LIMIT 1 FOR UPDATE`,
    [input.businessId, input.contactId],
  );
  const loyaltyPoints = Number(accountRows[0]?.balance_points ?? 0);
  const [reservedRows] = await connection.execute<any[]>(
    `SELECT vr.value_type, vr.points, vr.amount_cents
       FROM ims_online_shop_value_reservations vr
       JOIN ims_online_shop_checkouts c ON c.checkout_id = vr.checkout_id AND c.business_id = vr.business_id
      WHERE vr.business_id = ? AND vr.contact_id = ? AND vr.checkout_id <> ?
        AND vr.status = 'active' AND (vr.expires_at > UTC_TIMESTAMP() OR c.status = 'payment_pending')
      FOR UPDATE`,
    [input.businessId, input.contactId, input.checkoutId],
  );
  const reservedPoints = reservedRows
    .filter(row => row.value_type === 'loyalty')
    .reduce((sum, row) => sum + Number(row.points ?? 0), 0);
  const reservedStoreCreditCents = reservedRows
    .filter(row => row.value_type === 'store_credit')
    .reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0);
  const [rewardRows] = await connection.execute<any[]>(
    `SELECT id, display_name, description, points_cost, value_aud FROM loyalty_rewards
      WHERE business_id = ? AND is_active = 1 ORDER BY sort_order, points_cost, id FOR UPDATE`,
    [input.businessId],
  );
  return {
    checkout,
    contact,
    loyaltyPoints,
    availableLoyaltyPoints: Math.max(0, loyaltyPoints - reservedPoints),
    reservedStoreCreditCents,
    rewards: rewardRows as RewardRow[],
  };
}

function buildQuote(
  context: Awaited<ReturnType<typeof lockContext>>,
  selected: { rewardId: number | null; requestedStoreCreditCents: number },
): OnlineShopValueQuote {
  const grossTotalCents = Number(context.checkout.subtotal_cents) + Number(context.checkout.shipping_cents);
  const reward = selected.rewardId === null ? null : context.rewards.find(row => Number(row.id) === selected.rewardId);
  if (selected.rewardId !== null && !reward) throw new Error('The selected reward is not available.');
  if (reward && !Number(context.contact.loyalty_member)) throw new Error('This customer is not enrolled in the loyalty program.');
  if (reward && Number(reward.points_cost) > context.availableLoyaltyPoints) throw new Error('There are not enough available loyalty points for this reward.');
  const allocation = allocateOnlineShopValue({
    grossTotalCents,
    rewardValueCents: reward ? cents(reward.value_aud) : 0,
    storeCreditBalanceCents: cents(context.contact.store_credit),
    storeCreditReservedElsewhereCents: context.reservedStoreCreditCents,
    requestedStoreCreditCents: selected.requestedStoreCreditCents,
  });
  return {
    checkoutId: context.checkout.checkout_id,
    grossTotalCents,
    loyaltyPoints: context.loyaltyPoints,
    availableLoyaltyPoints: context.availableLoyaltyPoints,
    storeCreditBalanceCents: cents(context.contact.store_credit),
    ...allocation,
    rewards: context.rewards.map(row => ({
      id: Number(row.id),
      name: row.display_name,
      description: row.description,
      pointsCost: Number(row.points_cost),
      valueCents: cents(row.value_aud),
      eligible: Boolean(context.contact.loyalty_member) && Number(row.points_cost) <= context.availableLoyaltyPoints && cents(row.value_aud) <= grossTotalCents,
    })),
  };
}

async function inTransaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export const OnlineShopValueService = {
  quote(input: { businessId: string; checkoutId: string; contactId: number; email: string }) {
    return runImsForBusiness(input.businessId, () => inTransaction(async connection => {
      const context = await lockContext(connection, input);
      const [currentRows] = await connection.execute<any[]>(
        `SELECT reward_id, value_type, amount_cents FROM ims_online_shop_value_reservations
          WHERE business_id = ? AND checkout_id = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP() FOR UPDATE`,
        [input.businessId, input.checkoutId],
      );
      return buildQuote(context, {
        rewardId: currentRows.find(row => row.value_type === 'loyalty')?.reward_id == null
          ? null
          : Number(currentRows.find(row => row.value_type === 'loyalty').reward_id),
        requestedStoreCreditCents: Number(currentRows.find(row => row.value_type === 'store_credit')?.amount_cents ?? 0),
      });
    }));
  },

  reserve(input: { businessId: string; checkoutId: string; contactId: number; email: string; rewardId: number | null; storeCreditCents: number }) {
    if (input.rewardId !== null && (!Number.isSafeInteger(input.rewardId) || input.rewardId <= 0)) throw new Error('Choose a valid reward.');
    if (!Number.isSafeInteger(input.storeCreditCents) || input.storeCreditCents < 0) throw new Error('Enter a valid store-credit amount.');
    return runImsForBusiness(input.businessId, () => inTransaction(async connection => {
      const context = await lockContext(connection, input);
      const quote = buildQuote(context, { rewardId: input.rewardId, requestedStoreCreditCents: input.storeCreditCents });
      await connection.execute(
        `UPDATE ims_online_shop_value_reservations SET status = 'released', released_at = UTC_TIMESTAMP()
          WHERE business_id = ? AND checkout_id = ? AND status = 'active'`,
        [input.businessId, input.checkoutId],
      );
      if (input.rewardId !== null && quote.loyaltyCents > 0) {
        const reward = context.rewards.find(row => Number(row.id) === input.rewardId)!;
        await connection.execute(
          `INSERT INTO ims_online_shop_value_reservations
             (business_id, checkout_id, contact_id, value_type, reward_id, points, amount_cents, status, idempotency_key, expires_at)
           VALUES (?, ?, ?, 'loyalty', ?, ?, ?, 'active', ?, ?)
           ON DUPLICATE KEY UPDATE reward_id = VALUES(reward_id), points = VALUES(points), amount_cents = VALUES(amount_cents),
             status = 'active', expires_at = VALUES(expires_at), finalized_at = NULL, released_at = NULL`,
          [input.businessId, input.checkoutId, input.contactId, input.rewardId, Number(reward.points_cost), quote.loyaltyCents,
            `native-checkout:${input.checkoutId}:loyalty`, context.checkout.expires_at],
        );
      }
      if (quote.storeCreditCents > 0) {
        await connection.execute(
          `INSERT INTO ims_online_shop_value_reservations
             (business_id, checkout_id, contact_id, value_type, amount_cents, status, idempotency_key, expires_at)
           VALUES (?, ?, ?, 'store_credit', ?, 'active', ?, ?)
           ON DUPLICATE KEY UPDATE amount_cents = VALUES(amount_cents), status = 'active', expires_at = VALUES(expires_at),
             finalized_at = NULL, released_at = NULL`,
          [input.businessId, input.checkoutId, input.contactId, quote.storeCreditCents,
            `native-checkout:${input.checkoutId}:store-credit`, context.checkout.expires_at],
        );
      }
      await connection.execute(
        `UPDATE ims_online_shop_checkouts SET loyalty_cents = ?, store_credit_cents = ?, total_cents = ?
          WHERE business_id = ? AND checkout_id = ?`,
        [quote.loyaltyCents, quote.storeCreditCents, quote.payableCents, input.businessId, input.checkoutId],
      );
      return quote;
    }));
  },
};