import type { PoolConnection } from 'mysql2/promise';

import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { LoyaltyRepository } from '@/lib/ims/LoyaltyRepository';
import { calculateProportionalReturnReversal } from '@/lib/loyalty/calculations';
import { allocateOnlineShopRefund } from '@/lib/onlineShop/onlineShopValueAllocation';
import { OnlineShopStripeConnectionRepository } from '@/lib/onlineShop/stripeConnect';
import { StripeConnectPaymentProvider } from '@/lib/onlineShop/stripePaymentProvider';
import { getIMSPool } from '@/services/IMSMySQLService';

interface NativeCreditNoteRow {
  id: number; status: string; settlement_method: string; total_amount: number | string;
  customer_id: number; so_id: number; native_checkout_id: string;
}

export interface NativeRefundSettlement {
  creditNoteId: number;
  stripeCents: number;
  storeCreditCents: number;
  status: string;
}

async function prepareRefund(input: { businessId: string; creditNoteId: number }): Promise<{
  settlement: NativeRefundSettlement;
  providerPaymentId: string | null;
  idempotencyKey: string;
} | null> {
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const [noteRows] = await connection.execute<any[]>(
      `SELECT cn.id, cn.status, cn.settlement_method, cn.total_amount, cn.customer_id, cn.so_id, so.native_checkout_id
         FROM ims_credit_notes cn
         JOIN ims_sales_orders so ON so.id = cn.so_id AND so.business_id = cn.business_id
        WHERE cn.business_id = ? AND cn.id = ? AND so.sales_channel = 'native_shop'
        LIMIT 1 FOR UPDATE`,
      [input.businessId, input.creditNoteId],
    );
    const note = noteRows[0] as NativeCreditNoteRow | undefined;
    if (!note || note.settlement_method !== 'refund') {
      await connection.commit();
      return null;
    }
    if (!['draft', 'awaiting_product', 'complete'].includes(note.status)) throw new Error('Native credit note is not available for refund.');
    if (!note.customer_id || !note.so_id || !note.native_checkout_id) throw new Error('Native credit note is missing its original order identity.');

    const [existingRows] = await connection.execute<any[]>(
      `SELECT stripe_cents, store_credit_cents, status, provider_payment_id, idempotency_key
         FROM ims_online_shop_refunds WHERE business_id = ? AND credit_note_id = ? LIMIT 1 FOR UPDATE`,
      [input.businessId, input.creditNoteId],
    );
    const existing = existingRows[0];
    if (existing?.status === 'completed' || existing?.status === 'provider_succeeded') {
      await connection.commit();
      return { settlement: { creditNoteId: input.creditNoteId, stripeCents: Number(existing.stripe_cents),
        storeCreditCents: Number(existing.store_credit_cents), status: existing.status },
        providerPaymentId: existing.provider_payment_id, idempotencyKey: existing.idempotency_key };
    }

    const [paymentRows] = await connection.execute<any[]>(
      `SELECT COALESCE(SUM(CASE WHEN notes LIKE 'Native Store Credit %' THEN amount ELSE 0 END), 0) AS store_credit,
              COALESCE(SUM(CASE WHEN notes LIKE 'Native Stripe %' THEN amount ELSE 0 END), 0) AS stripe
         FROM ims_sales_order_payments WHERE business_id = ? AND so_id = ? FOR UPDATE`,
      [input.businessId, note.so_id],
    );
    const [priorRows] = await connection.execute<any[]>(
      `SELECT COALESCE(SUM(stripe_cents), 0) AS stripe_cents,
              COALESCE(SUM(store_credit_cents), 0) AS store_credit_cents
         FROM ims_online_shop_refunds
        WHERE business_id = ? AND so_id = ? AND credit_note_id <> ? AND status <> 'failed' FOR UPDATE`,
      [input.businessId, note.so_id, input.creditNoteId],
    );
    const allocation = allocateOnlineShopRefund({
      refundCents: Math.round(Number(note.total_amount) * 100),
      originalStripeCents: Math.round(Number(paymentRows[0]?.stripe ?? 0) * 100),
      originalStoreCreditCents: Math.round(Number(paymentRows[0]?.store_credit ?? 0) * 100),
      refundedStripeCents: Number(priorRows[0]?.stripe_cents ?? 0),
      refundedStoreCreditCents: Number(priorRows[0]?.store_credit_cents ?? 0),
    });
    let providerPaymentId: string | null = null;
    if (allocation.stripeCents > 0) {
      const [attemptRows] = await connection.execute<any[]>(
        `SELECT provider_payment_id FROM ims_online_shop_payment_attempts
          WHERE business_id = ? AND checkout_id = ? AND provider = 'stripe' AND status = 'succeeded'
          ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [input.businessId, note.native_checkout_id],
      );
      providerPaymentId = attemptRows[0]?.provider_payment_id ?? null;
      if (!providerPaymentId) throw new Error('The original Stripe payment could not be verified.');
    }
    const idempotencyKey = `native-credit-note:${input.creditNoteId}:refund`;
    await connection.execute(
      `INSERT INTO ims_online_shop_refunds
         (business_id, credit_note_id, checkout_id, so_id, contact_id, provider_payment_id,
          stripe_cents, store_credit_cents, status, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?)
       ON DUPLICATE KEY UPDATE provider_payment_id = VALUES(provider_payment_id), stripe_cents = VALUES(stripe_cents),
         store_credit_cents = VALUES(store_credit_cents), status = 'prepared', safe_error = NULL`,
      [input.businessId, input.creditNoteId, note.native_checkout_id, note.so_id, note.customer_id,
        providerPaymentId, allocation.stripeCents, allocation.storeCreditCents, idempotencyKey],
    );
    await connection.commit();
    return { settlement: { creditNoteId: input.creditNoteId, ...allocation, status: 'prepared' }, providerPaymentId, idempotencyKey };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function settleNativeCreditNoteRefund(input: { businessId: string; creditNoteId: number }): Promise<NativeRefundSettlement | null> {
  return runImsForBusiness(input.businessId, async () => {
    const prepared = await prepareRefund(input);
    if (!prepared) return null;
    if (prepared.settlement.status === 'completed' || prepared.settlement.status === 'provider_succeeded') return prepared.settlement;
    let providerRefundId: string | null = null;
    try {
      if (prepared.settlement.stripeCents > 0) {
        const stripeConnection = await OnlineShopStripeConnectionRepository.getReady(input.businessId);
        const result = await new StripeConnectPaymentProvider(stripeConnection.stripeAccountId).refund(
          prepared.providerPaymentId!, prepared.settlement.stripeCents, prepared.idempotencyKey,
        );
        providerRefundId = result.providerPaymentId;
        if (result.status !== 'refunded') throw new Error('Stripe refund is still processing. Retry completion after it settles.');
      }
      const connection = await getIMSPool().getConnection();
      try {
        await connection.execute(
          `UPDATE ims_online_shop_refunds SET status = 'provider_succeeded', provider_refund_id = ?, safe_error = NULL
            WHERE business_id = ? AND credit_note_id = ?`,
          [providerRefundId, input.businessId, input.creditNoteId],
        );
      } finally { connection.release(); }
      return { ...prepared.settlement, status: 'provider_succeeded' };
    } catch (error) {
      const connection = await getIMSPool().getConnection();
      try {
        await connection.execute(
          `UPDATE ims_online_shop_refunds SET status = 'failed', provider_refund_id = COALESCE(?, provider_refund_id), safe_error = ?
            WHERE business_id = ? AND credit_note_id = ?`,
          [providerRefundId, error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500), input.businessId, input.creditNoteId],
        );
      } finally { connection.release(); }
      throw error;
    }
  });
}

export async function applyNativeRefundLedgers(
  connection: PoolConnection,
  input: { businessId: string; creditNoteId: number; contactId: number; checkoutId: string },
): Promise<number | null> {
  const [refundRows] = await connection.execute<any[]>(
    `SELECT id, store_credit_cents, status FROM ims_online_shop_refunds
      WHERE business_id = ? AND credit_note_id = ? LIMIT 1 FOR UPDATE`,
    [input.businessId, input.creditNoteId],
  );
  const refund = refundRows[0];
  if (!refund || !['provider_succeeded', 'completed'].includes(refund.status)) {
    throw new Error('Native payment refund must succeed before the credit note can be completed.');
  }
  if (refund.status === 'completed') {
    const [transactionRows] = await connection.execute<any[]>(
      'SELECT id FROM store_credit_transactions WHERE idempotency_key = ? LIMIT 1 FOR UPDATE',
      [`native-credit-note:${input.creditNoteId}:store-credit-restore`],
    );
    return transactionRows[0] ? Number(transactionRows[0].id) : null;
  }

  let storeCreditTransactionId: number | null = null;
  const storeCreditAmount = Number(refund.store_credit_cents) / 100;
  if (storeCreditAmount > 0) {
    const [contactRows] = await connection.execute<any[]>(
      'SELECT store_credit FROM ims_contacts WHERE business_id = ? AND id = ? LIMIT 1 FOR UPDATE',
      [input.businessId, input.contactId],
    );
    if (!contactRows[0]) throw new Error('The native order customer is no longer available.');
    const balanceAfter = Math.round((Number(contactRows[0].store_credit) + storeCreditAmount) * 100) / 100;
    const [transactionResult] = await connection.execute<any>(
      `INSERT INTO store_credit_transactions
         (contact_id, type, amount, balance_after, credit_note_id, idempotency_key, notes)
       VALUES (?, 'adjust', ?, ?, ?, ?, ?)`,
      [input.contactId, storeCreditAmount, balanceAfter, input.creditNoteId,
        `native-credit-note:${input.creditNoteId}:store-credit-restore`, `Restored from native credit note ${input.creditNoteId}`],
    );
    storeCreditTransactionId = Number(transactionResult.insertId);
    await connection.execute('UPDATE ims_contacts SET store_credit = ? WHERE business_id = ? AND id = ?',
      [balanceAfter, input.businessId, input.contactId]);
  }

  const [checkoutRows] = await connection.execute<any[]>(
    'SELECT subtotal_cents, loyalty_cents FROM ims_online_shop_checkouts WHERE business_id = ? AND checkout_id = ? LIMIT 1 FOR UPDATE',
    [input.businessId, input.checkoutId],
  );
  const originalSubtotalCents = Number(checkoutRows[0]?.subtotal_cents ?? 0);
  const originalEligibleCents = Math.max(0, originalSubtotalCents - Number(checkoutRows[0]?.loyalty_cents ?? 0));
  const [returnedRows] = await connection.execute<any[]>(
    `SELECT COALESCE(SUM(cni.line_total), 0) AS returned_merchandise
       FROM ims_credit_notes cn
       JOIN ims_credit_note_items cni ON cni.cn_id = cn.id
       JOIN ims_sales_order_items soi ON soi.id = cni.source_so_item_id
       JOIN ims_sales_orders so ON so.id = soi.so_id AND so.business_id = cn.business_id
      WHERE cn.business_id = ? AND so.native_checkout_id = ?
        AND (cn.status = 'complete' OR cn.id = ?)`,
    [input.businessId, input.checkoutId, input.creditNoteId],
  );
  const returnedGrossCents = Math.round(Number(returnedRows[0]?.returned_merchandise ?? 0) * 100);
  const cumulativeReturnedCents = originalSubtotalCents > 0
    ? Math.min(originalEligibleCents, Math.round(returnedGrossCents * originalEligibleCents / originalSubtotalCents)) : 0;

  const [earnRows] = await connection.execute<any[]>(
    `SELECT t.id, t.points_delta FROM loyalty_transactions t
      WHERE t.business_id = ? AND t.type = 'earn' AND t.source_type = 'native_checkout' AND t.source_id = ?
      ORDER BY t.id LIMIT 1 FOR UPDATE`,
    [input.businessId, input.checkoutId],
  );
  if (earnRows[0]) {
    const [reversedRows] = await connection.execute<any[]>(
      `SELECT COALESCE(SUM(ABS(points_delta)), 0) AS points FROM loyalty_transactions
        WHERE business_id = ? AND type = 'earn_reversal' AND source_type = 'native_checkout_return' AND source_id = ? FOR UPDATE`,
      [input.businessId, input.checkoutId],
    );
    const points = calculateProportionalReturnReversal({ originalEarned: Number(earnRows[0].points_delta), originalEligibleCents,
      cumulativeReturnedCents, alreadyReversed: Number(reversedRows[0]?.points ?? 0) });
    if (points > 0) await LoyaltyRepository.applyTransaction(connection, { businessId: input.businessId, contactId: input.contactId,
      type: 'earn_reversal', pointsDelta: -points, channel: 'native_shop', sourceType: 'native_checkout_return', sourceId: input.checkoutId,
      idempotencyKey: `native-credit-note:${input.creditNoteId}:earn-reversal`, reason: `Native credit note ${input.creditNoteId}` });
  }

  const [redemptionRows] = await connection.execute<any[]>(
    `SELECT r.points_deducted FROM loyalty_redemptions r
      JOIN ims_online_shop_value_reservations vr ON vr.loyalty_redemption_id = r.id AND vr.business_id = r.business_id
     WHERE vr.business_id = ? AND vr.checkout_id = ? AND vr.value_type = 'loyalty' LIMIT 1 FOR UPDATE`,
    [input.businessId, input.checkoutId],
  );
  if (redemptionRows[0] && originalEligibleCents > 0) {
    const [restoredRows] = await connection.execute<any[]>(
      `SELECT COALESCE(SUM(points_delta), 0) AS points FROM loyalty_transactions
        WHERE business_id = ? AND type = 'redeem_reversal' AND source_type = 'native_checkout_return' AND source_id = ? FOR UPDATE`,
      [input.businessId, input.checkoutId],
    );
    const target = Math.floor(Number(redemptionRows[0].points_deducted) * cumulativeReturnedCents / originalEligibleCents);
    const points = Math.max(0, target - Number(restoredRows[0]?.points ?? 0));
    if (points > 0) await LoyaltyRepository.applyTransaction(connection, { businessId: input.businessId, contactId: input.contactId,
      type: 'redeem_reversal', pointsDelta: points, channel: 'native_shop', sourceType: 'native_checkout_return', sourceId: input.checkoutId,
      idempotencyKey: `native-credit-note:${input.creditNoteId}:redeem-reversal`, reason: `Native credit note ${input.creditNoteId}` });
  }

  await connection.execute(
    `UPDATE ims_online_shop_refunds SET status = 'completed', completed_at = UTC_TIMESTAMP()
      WHERE business_id = ? AND credit_note_id = ?`,
    [input.businessId, input.creditNoteId],
  );
  return storeCreditTransactionId;
}