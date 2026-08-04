import type { RowDataPacket } from 'mysql2/promise';

import { LoyaltyRepository, LoyaltyValidationError } from '@/lib/ims/LoyaltyRepository';
import { calculateEarnedPoints, parseLoyaltySettings } from '@/lib/loyalty/calculations';
import { LOYALTY_SETTING_KEYS, type LoyaltyMutationResult } from '@/lib/loyalty/types';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool } from '@/services/IMSMySQLService';

export type ShopifyLoyaltyAwardResult =
  | { status: 'awarded'; points: number | null; mutation: LoyaltyMutationResult }
  | { status: 'skipped'; reason: 'order_not_found' | 'not_paid' | 'no_customer' | 'program_inactive' | 'customer_not_enrolled' | 'no_eligible_spend' };

export const ShopifyLoyaltyService = {
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
        channel: 'shopify',
        sourceType: 'shopify_order',
        sourceId: input.shopifyOrderId,
        idempotencyKey,
        reason: `Shopify order ${input.shopifyOrderId} paid`,
      });
      await connection.commit();
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
      connection.release();
    }
  },
};