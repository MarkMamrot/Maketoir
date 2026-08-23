import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { OnlineShopStripeConnectionRepository } from '@/lib/onlineShop/stripeConnect';
import { StripeConnectPaymentProvider } from '@/lib/onlineShop/stripePaymentProvider';
import { getIMSPool } from '@/services/IMSMySQLService';
import { OnlineShopOrderFinalizer } from '@/lib/onlineShop/onlineShopOrderFinalizer';

export interface OnlineShopPaymentClientSession {
  checkoutId: string;
  completed: boolean;
  clientSecret?: string;
  publishableKey?: string;
  stripeAccountId?: string;
}

async function createInTenant(input: { businessId: string; checkoutId: string }): Promise<OnlineShopPaymentClientSession> {
  const connection = await getIMSPool().getConnection();
  let checkout: { checkout_id: string; guest_email: string; loyalty_cents: number; store_credit_cents: number; total_cents: number; currency_code: string; status: string };
  let existing: { provider_payment_id: string } | undefined;
  try {
    await connection.beginTransaction();
    const [checkoutRows] = await connection.execute<any[]>(
      `SELECT checkout_id, guest_email, loyalty_cents, store_credit_cents, total_cents, currency_code, status
         FROM ims_online_shop_checkouts
        WHERE business_id = ? AND checkout_id = ? AND status IN ('open','payment_pending') AND expires_at > UTC_TIMESTAMP()
        LIMIT 1 FOR UPDATE`, [input.businessId, input.checkoutId],
    );
    checkout = checkoutRows[0];
    if (!checkout) throw new Error('Checkout has expired or is unavailable.');
    const [attemptRows] = await connection.execute<any[]>(
      `SELECT provider_payment_id FROM ims_online_shop_payment_attempts
        WHERE business_id = ? AND checkout_id = ? AND provider = 'stripe' ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [input.businessId, input.checkoutId],
    );
    existing = attemptRows[0];
    const [valueRows] = await connection.execute<any[]>(
      `SELECT value_type, COALESCE(SUM(amount_cents), 0) AS amount_cents
         FROM ims_online_shop_value_reservations
        WHERE business_id = ? AND checkout_id = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP()
        GROUP BY value_type FOR UPDATE`,
      [input.businessId, input.checkoutId],
    );
    const reservedLoyaltyCents = Number(valueRows.find(row => row.value_type === 'loyalty')?.amount_cents ?? 0);
    const reservedStoreCreditCents = Number(valueRows.find(row => row.value_type === 'store_credit')?.amount_cents ?? 0);
    if (reservedLoyaltyCents !== Number(checkout.loyalty_cents)
      || reservedStoreCreditCents !== Number(checkout.store_credit_cents)) {
      throw new Error('Reserved rewards or store credit have expired. Review the order total before paying.');
    }
    await connection.execute(
      `UPDATE ims_online_shop_stock_reservations SET expires_at = GREATEST(expires_at, UTC_TIMESTAMP() + INTERVAL 2 HOUR)
        WHERE business_id = ? AND checkout_id = ? AND status = 'active'`, [input.businessId, input.checkoutId],
    );
    await connection.execute(
      `UPDATE ims_online_shop_value_reservations SET expires_at = GREATEST(expires_at, UTC_TIMESTAMP() + INTERVAL 2 HOUR)
        WHERE business_id = ? AND checkout_id = ? AND status = 'active'`, [input.businessId, input.checkoutId],
    );
    if (Number(checkout.total_cents) === 0) {
      const providerPaymentId = `account-value:${input.checkoutId}`;
      await connection.execute(
        `INSERT INTO ims_online_shop_payment_attempts
           (business_id, checkout_id, provider, provider_payment_id, idempotency_key, status, amount_cents, currency_code)
         VALUES (?, ?, 'account_value', ?, ?, 'processing', 0, 'AUD')
         ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
        [input.businessId, input.checkoutId, providerPaymentId, `native-checkout:${input.checkoutId}:account-value`],
      );
      await connection.execute(
        `UPDATE ims_online_shop_checkouts SET status = 'payment_pending', expires_at = GREATEST(expires_at, UTC_TIMESTAMP() + INTERVAL 2 HOUR)
          WHERE business_id = ? AND checkout_id = ?`, [input.businessId, input.checkoutId],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback(); throw error;
  } finally { connection.release(); }

  if (Number(checkout.total_cents) === 0) {
    await OnlineShopOrderFinalizer.finalizePaid({ businessId: input.businessId, checkoutId: input.checkoutId,
      provider: 'account_value', providerPaymentId: `account-value:${input.checkoutId}`, amountCents: 0 });
    return { checkoutId: input.checkoutId, completed: true };
  }

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) throw new Error('Stripe publishable key is not configured.');
  const stripeConnection = await OnlineShopStripeConnectionRepository.getReady(input.businessId);

  const provider = new StripeConnectPaymentProvider(stripeConnection.stripeAccountId);
  const idempotencyKey = `native-checkout:${input.checkoutId}`;
  const payment = await provider.createPayment({ businessId: input.businessId, checkoutId: input.checkoutId,
    amountMinor: Number(checkout.total_cents), currency: 'AUD', idempotencyKey, customerEmail: checkout.guest_email });
  if (!payment.clientSecret) throw new Error('Stripe did not return a payment client secret.');
  const persist = await getIMSPool().getConnection();
  try {
    await persist.beginTransaction();
    await persist.execute(
      `INSERT INTO ims_online_shop_payment_attempts
         (business_id, checkout_id, provider, provider_payment_id, idempotency_key, status, amount_cents, currency_code)
       VALUES (?, ?, 'stripe', ?, ?, ?, ?, 'AUD')
       ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = CURRENT_TIMESTAMP`,
      [input.businessId, input.checkoutId, payment.providerPaymentId, idempotencyKey, payment.status, Number(checkout.total_cents)],
    );
    await persist.execute(
      `UPDATE ims_online_shop_checkouts SET status = 'payment_pending', expires_at = GREATEST(expires_at, UTC_TIMESTAMP() + INTERVAL 2 HOUR)
        WHERE business_id = ? AND checkout_id = ? AND status IN ('open','payment_pending')`, [input.businessId, input.checkoutId],
    );
    await persist.execute(
      `UPDATE ims_online_shop_stock_reservations SET expires_at = GREATEST(expires_at, UTC_TIMESTAMP() + INTERVAL 2 HOUR)
        WHERE business_id = ? AND checkout_id = ? AND status = 'active'`, [input.businessId, input.checkoutId],
    );
    await persist.execute(
      `UPDATE ims_online_shop_value_reservations SET expires_at = GREATEST(expires_at, UTC_TIMESTAMP() + INTERVAL 2 HOUR)
        WHERE business_id = ? AND checkout_id = ? AND status = 'active'`, [input.businessId, input.checkoutId],
    );
    await persist.commit();
  } catch (error) { await persist.rollback(); throw error; } finally { persist.release(); }
  void existing;
  return { checkoutId: input.checkoutId, completed: false, clientSecret: payment.clientSecret, publishableKey, stripeAccountId: stripeConnection.stripeAccountId };
}

export const OnlineShopPaymentService = {
  create(input: { businessId: string; checkoutId: string }) {
    if (!/^[0-9a-f-]{36}$/i.test(input.checkoutId)) throw new Error('A valid checkout ID is required.');
    return runImsForBusiness(input.businessId, () => createInTenant(input));
  },
};