import type { RowDataPacket } from 'mysql2/promise';

import { LoyaltyRepository, LoyaltyValidationError } from '@/lib/ims/LoyaltyRepository';
import { calculateEarnedPoints, calculateProportionalReturnReversal, parseLoyaltySettings } from '@/lib/loyalty/calculations';
import { ShopifyLoyaltyMetafieldService } from '@/lib/loyalty/ShopifyLoyaltyMetafieldService';
import { LOYALTY_SETTING_KEYS, type LoyaltyMutationResult } from '@/lib/loyalty/types';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool } from '@/services/IMSMySQLService';

export type ShopifyLoyaltyAwardResult =
  | { status: 'awarded'; points: number | null; mutation: LoyaltyMutationResult }
  | { status: 'skipped'; reason: 'order_not_found' | 'not_paid' | 'no_customer' | 'program_inactive' | 'customer_not_enrolled' | 'no_eligible_spend' };

export type ShopifyLoyaltyRefundResult =
  | { status: 'reversed'; points: number | null; mutation: LoyaltyMutationResult }
  | { status: 'skipped'; reason: 'original_award_not_found' | 'no_eligible_spend' | 'no_points_to_reverse' };

export interface ShopifyLoyaltyRedemptionUseResult {
  used: number;
}

export const ShopifyLoyaltyService = {
  async markPaidOrderRedemptionsUsed(input: {
    businessId: string;
    shopifyOrderId: string;
    shopifyCustomerId: string;
    discountCodes: string[];
  }): Promise<ShopifyLoyaltyRedemptionUseResult> {
    const codes = [...new Set(input.discountCodes.map(code => code.trim().toUpperCase()).filter(Boolean))];
    if (!input.shopifyCustomerId.trim() || codes.length === 0) return { used: 0 };
    try {
      let used = 0;
      for (const code of codes) {
        if (await LoyaltyRepository.markShopifyVoucherUsed(input.businessId, code, input.shopifyCustomerId)) used += 1;
      }
      return { used };
    } catch (error) {
      await reportRuntimeIssue({
        businessId: input.businessId,
        source: 'shopify_loyalty',
        operation: 'mark_reward_used',
        title: 'Shopify loyalty reward usage update failed',
        error,
        context: { shopifyOrderId: input.shopifyOrderId, discountCodeCount: codes.length },
        reference: { type: 'shopify_order', id: input.shopifyOrderId },
      });
      throw error;
    }
  },

  async awardPaidOrder(input: {
    businessId: string;
    shopifyOrderId: string;
    paidDate: string;
    eligibleSpend: number;
  }): Promise<ShopifyLoyaltyAwardResult> {
    const idempotencyKey = `shopify:order:${input.shopifyOrderId}:earn`;
    const existing = await LoyaltyRepository.getMutationByIdempotencyKey(input.businessId, idempotencyKey);
    if (existing) return { status: 'awarded', points: null, mutation: existing };

    const pool = getIMSPool();
    const connection = await pool.getConnection();
    let released = false;
    try {
      await connection.beginTransaction();
      const [orders] = await connection.execute<RowDataPacket[]>(
        `SELECT id, customer_id, financial_status
           FROM ims_sales_orders
          WHERE business_id = ? AND shopify_order_id = ?
          LIMIT 1
          FOR UPDATE`,
        [input.businessId, input.shopifyOrderId],
      );
      const order = orders[0];
      if (!order) {
        await connection.commit();
        return { status: 'skipped', reason: 'order_not_found' };
      }
      if (String(order.financial_status ?? '').toLowerCase() !== 'paid') {
        await connection.commit();
        return { status: 'skipped', reason: 'not_paid' };
      }
      const contactId = Number(order.customer_id);
      if (!Number.isInteger(contactId) || contactId <= 0) {
        await connection.commit();
        return { status: 'skipped', reason: 'no_customer' };
      }

      const keys = Object.values(LOYALTY_SETTING_KEYS);
      const placeholders = keys.map(() => '?').join(',');
      const [settingRows] = await connection.execute<RowDataPacket[]>(
        `SELECT \`key\`, value
           FROM ims_settings
          WHERE business_id = ? AND \`key\` IN (${placeholders})`,
        [input.businessId, ...keys],
      );
      const settings = parseLoyaltySettings(Object.fromEntries(settingRows.map(row => [String(row.key), String(row.value ?? '')])));
      if (!settings.enabled || (settings.startedAt && input.paidDate < settings.startedAt)) {
        await connection.commit();
        return { status: 'skipped', reason: 'program_inactive' };
      }

      const [contacts] = await connection.execute<RowDataPacket[]>(
        `SELECT id
           FROM ims_contacts
          WHERE id = ? AND business_id = ? AND is_active = 1 AND loyalty_member = 1
            AND type IN ('retail_customer','b2b_customer','both')
          LIMIT 1`,
        [contactId, input.businessId],
      );
      if (!contacts[0]) {
        await connection.commit();
        return { status: 'skipped', reason: 'customer_not_enrolled' };
      }

      const points = calculateEarnedPoints({ merchandiseTotal: input.eligibleSpend, earnRate: settings.earnRate });
      if (points <= 0) {
        await connection.commit();
        return { status: 'skipped', reason: 'no_eligible_spend' };
      }
      const mutation = await LoyaltyRepository.applyTransaction(connection, {
        businessId: input.businessId,
        contactId,
        type: 'earn',
        pointsDelta: points,
        eligibleSpendCents: Math.round(input.eligibleSpend * 100),
        channel: 'shopify',
        sourceType: 'shopify_order',
        sourceId: input.shopifyOrderId,
        idempotencyKey,
        reason: `Shopify order ${input.shopifyOrderId} paid`,
      });
      await connection.commit();
      connection.release();
      released = true;
      await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({
        businessId: input.businessId,
        contactId,
      });
      return { status: 'awarded', points, mutation };
    } catch (error) {
      await connection.rollback();
      if (error instanceof LoyaltyValidationError) {
        return { status: 'skipped', reason: 'customer_not_enrolled' };
      }
      await reportRuntimeIssue({
        businessId: input.businessId,
        source: 'shopify_loyalty',
        operation: 'award_paid_order',
        title: 'Shopify paid-order loyalty award failed',
        error,
        context: { shopifyOrderId: input.shopifyOrderId },
        reference: { type: 'shopify_order', id: input.shopifyOrderId },
      });
      throw error;
    } finally {
      if (!released) connection.release();
    }
  },

  async reverseRefund(input: {
    businessId: string;
    shopifyOrderId: string;
    shopifyRefundId: string;
    eligibleRefundSpend: number;
  }): Promise<ShopifyLoyaltyRefundResult> {
    const idempotencyKey = `shopify:refund:${input.shopifyRefundId}:earn`;
    const existing = await LoyaltyRepository.getMutationByIdempotencyKey(input.businessId, idempotencyKey);
    if (existing) return { status: 'reversed', points: null, mutation: existing };

    const eligibleRefundCents = Math.max(0, Math.round(Number(input.eligibleRefundSpend) * 100));
    if (eligibleRefundCents === 0) return { status: 'skipped', reason: 'no_eligible_spend' };

    const pool = getIMSPool();
    const connection = await pool.getConnection();
    let released = false;
    try {
      await connection.beginTransaction();
      const [earns] = await connection.execute<RowDataPacket[]>(
        `SELECT t.id, t.account_id, a.contact_id, t.points_delta, t.eligible_spend_cents
           FROM ims_sales_orders so
           JOIN loyalty_transactions t
             ON t.business_id = so.business_id
            AND t.type = 'earn'
            AND t.source_type = 'shopify_order'
            AND t.source_id = so.shopify_order_id
           JOIN loyalty_accounts a ON a.id = t.account_id AND a.business_id = t.business_id
          WHERE so.business_id = ? AND so.shopify_order_id = ?
          ORDER BY t.id
          LIMIT 1
          FOR UPDATE`,
        [input.businessId, input.shopifyOrderId],
      );
      const earn = earns[0];
      if (!earn) {
        await connection.commit();
        return { status: 'skipped', reason: 'original_award_not_found' };
      }
      const originalEligibleCents = Number(earn.eligible_spend_cents);
      if (!Number.isInteger(originalEligibleCents) || originalEligibleCents <= 0) {
        throw new Error(`Shopify order ${input.shopifyOrderId} loyalty award has no eligible-spend snapshot`);
      }

      const [priorRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, account_id, points_delta, balance_after, eligible_spend_cents, idempotency_key
           FROM loyalty_transactions
          WHERE business_id = ? AND type = 'earn_reversal'
            AND source_type = 'shopify_order_refund' AND source_id = ?
          ORDER BY id
          FOR UPDATE`,
        [input.businessId, input.shopifyOrderId],
      );
      const replay = priorRows.find(row => String(row.idempotency_key) === idempotencyKey);
      if (replay) {
        await connection.commit();
        return {
          status: 'reversed',
          points: null,
          mutation: {
            transactionId: Number(replay.id),
            accountId: Number(replay.account_id),
            balanceAfter: Number(replay.balance_after),
            duplicate: true,
          },
        };
      }

      const alreadyReversed = priorRows.reduce((sum, row) => sum + Math.abs(Number(row.points_delta)), 0);
      const priorEligibleCents = priorRows.reduce((sum, row) => sum + Math.max(0, Number(row.eligible_spend_cents) || 0), 0);
      const points = calculateProportionalReturnReversal({
        originalEarned: Number(earn.points_delta),
        originalEligibleCents,
        cumulativeReturnedCents: priorEligibleCents + eligibleRefundCents,
        alreadyReversed,
      });
      if (points <= 0) {
        await connection.commit();
        return { status: 'skipped', reason: 'no_points_to_reverse' };
      }

      const mutation = await LoyaltyRepository.applyTransaction(connection, {
        businessId: input.businessId,
        contactId: Number(earn.contact_id),
        type: 'earn_reversal',
        pointsDelta: -points,
        eligibleSpendCents: eligibleRefundCents,
        channel: 'shopify',
        sourceType: 'shopify_order_refund',
        sourceId: input.shopifyOrderId,
        idempotencyKey,
        reason: `Shopify refund ${input.shopifyRefundId} for order ${input.shopifyOrderId}`,
        allowNegativeBalance: true,
      });
      await connection.commit();
      connection.release();
      released = true;
      await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({
        businessId: input.businessId,
        contactId: Number(earn.contact_id),
      });
      return { status: 'reversed', points, mutation };
    } catch (error) {
      await connection.rollback();
      await reportRuntimeIssue({
        businessId: input.businessId,
        source: 'shopify_loyalty',
        operation: 'reverse_refund',
        title: 'Shopify refund loyalty reversal failed',
        error,
        context: { shopifyOrderId: input.shopifyOrderId, shopifyRefundId: input.shopifyRefundId },
        reference: { type: 'shopify_refund', id: input.shopifyRefundId },
      });
      throw error;
    } finally {
      if (!released) connection.release();
    }
  },
};