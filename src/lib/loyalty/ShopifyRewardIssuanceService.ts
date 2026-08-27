import { randomBytes } from 'crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import {
  LoyaltyRepository,
  LoyaltyValidationError,
  type LoyaltyIssuedRedemption,
} from '@/lib/ims/LoyaltyRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool } from '@/services/IMSMySQLService';
import { ShopifyAdminUserError } from '@/services/ShopifyService';
import { ShopifyLoyaltyMetafieldService } from '@/lib/loyalty/ShopifyLoyaltyMetafieldService';

export interface ShopifyDiscountClient {
  findDiscountCode(code: string): Promise<{ id: string; code: string } | null>;
  createCustomerDiscountCode(input: {
    code: string;
    title: string;
    amountAud: number;
    shopifyCustomerId: string;
    startsAt: string;
    endsAt: string;
  }): Promise<{ id: string; code: string }>;
}

export interface ShopifyRewardIssueResult extends LoyaltyIssuedRedemption {
  status: 'issued';
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

function rewardCode(redemptionId: number): string {
  return `SOLV-${redemptionId}-${randomBytes(8).toString('hex')}`.toUpperCase();
}

function expiryWindow(now: Date): { startsAt: string; endsAt: string } {
  const endsAt = new Date(now);
  endsAt.setUTCDate(endsAt.getUTCDate() + 90);
  return { startsAt: now.toISOString(), endsAt: endsAt.toISOString() };
}

function issuedResult(
  redemption: LoyaltyIssuedRedemption,
  discount: { id: string; code: string },
): ShopifyRewardIssueResult {
  return {
    ...redemption,
    status: 'issued',
    shopifyDiscountId: discount.id,
    voucherCode: discount.code,
  };
}

export const ShopifyRewardIssuanceService = {
  async issue(input: {
    businessId: string;
    contactId: number;
    rewardId: number;
    idempotencyKey: string;
    actorId?: string | number | null;
    shopify: ShopifyDiscountClient;
    now?: Date;
  }): Promise<ShopifyRewardIssueResult> {
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 191) {
      throw new LoyaltyValidationError('A valid idempotency key is required.');
    }

    const existing = await LoyaltyRepository.getRedemptionByIdempotencyKey(input.businessId, input.idempotencyKey);
    if (existing) {
      if (existing.contactId !== input.contactId || existing.rewardId !== input.rewardId) {
        throw new LoyaltyValidationError('The idempotency key was already used for a different loyalty redemption.');
      }
      if (existing.status === 'issued' && existing.shopifyDiscountId && existing.voucherCode) {
        return { ...existing, status: 'issued' };
      }
      if (existing.status !== 'reserved') {
        throw new LoyaltyValidationError('This loyalty redemption can no longer be issued.');
      }
    }

    const prepared = await inTransaction(async connection => {
      const [settings] = await connection.execute<RowDataPacket[]>(
        `SELECT value FROM ims_settings
          WHERE business_id = ? AND \`key\` = 'loyalty_enabled'
          LIMIT 1
          FOR UPDATE`,
        [input.businessId],
      );
      if (String(settings[0]?.value ?? '0') !== '1') {
        throw new LoyaltyValidationError('The loyalty program is switched off.');
      }
      const [contacts] = await connection.execute<RowDataPacket[]>(
        `SELECT shopify_customer_id
           FROM ims_contacts
          WHERE id = ? AND business_id = ? AND is_active = 1 AND loyalty_member = 1
            AND type IN ('retail_customer','b2b_customer','both')
          LIMIT 1
          FOR UPDATE`,
        [input.contactId, input.businessId],
      );
      const shopifyCustomerId = String(contacts[0]?.shopify_customer_id ?? '').trim();
      if (!shopifyCustomerId) {
        throw new LoyaltyValidationError('This loyalty customer is not linked to a Shopify customer.');
      }
      const reservation = await LoyaltyRepository.reserveReward(connection, {
        businessId: input.businessId,
        contactId: input.contactId,
        rewardId: input.rewardId,
        idempotencyKey: input.idempotencyKey,
        channel: 'shopify',
        actorId: input.actorId,
      });
      if (reservation.status !== 'reserved') {
        throw new LoyaltyValidationError('This loyalty redemption can no longer be issued.');
      }
      const voucherCode = await LoyaltyRepository.prepareRedemptionVoucher(connection, {
        businessId: input.businessId,
        redemptionId: reservation.redemptionId,
        voucherCode: rewardCode(reservation.redemptionId),
      });
      return { reservation, shopifyCustomerId, voucherCode };
    });

    const base: LoyaltyIssuedRedemption = {
      ...prepared.reservation,
      contactId: input.contactId,
      shopifyDiscountId: null,
      voucherCode: prepared.voucherCode,
    };
    let discount: { id: string; code: string };
    let expiresAt: string | null = null;
    try {
      const found = await input.shopify.findDiscountCode(prepared.voucherCode);
      if (found) {
        discount = found;
      } else {
        const window = expiryWindow(input.now ?? new Date());
        expiresAt = window.endsAt;
        discount = await input.shopify.createCustomerDiscountCode({
          code: prepared.voucherCode,
          title: `Loyalty reward ${prepared.reservation.redemptionId}`,
          amountAud: prepared.reservation.rewardValueAud,
          shopifyCustomerId: prepared.shopifyCustomerId,
          ...window,
        });
      }
    } catch (error) {
      await reportRuntimeIssue({
        businessId: input.businessId,
        source: 'shopify_loyalty',
        operation: 'issue_reward_code',
        title: 'Shopify loyalty reward code issuance failed',
        error,
        context: { contactId: input.contactId, rewardId: input.rewardId, redemptionId: prepared.reservation.redemptionId },
        reference: { type: 'loyalty_redemption', id: prepared.reservation.redemptionId },
      });
      let recovered: { id: string; code: string } | null = null;
      try {
        recovered = await input.shopify.findDiscountCode(prepared.voucherCode);
      } catch {
        await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({
          businessId: input.businessId,
          contactId: input.contactId,
        });
        throw error;
      }
      if (recovered) {
        discount = recovered;
      } else if (error instanceof ShopifyAdminUserError) {
        await inTransaction(connection => LoyaltyRepository.cancelReservedRedemption(connection, {
          businessId: input.businessId,
          redemptionId: prepared.reservation.redemptionId,
          actorId: input.actorId,
          reason: `Shopify rejected reward code creation: ${error.message}`.slice(0, 500),
        }));
        await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({
          businessId: input.businessId,
          contactId: input.contactId,
        });
        throw error;
      } else {
        await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({
          businessId: input.businessId,
          contactId: input.contactId,
        });
        throw error;
      }
    }

    await inTransaction(connection => LoyaltyRepository.markRedemptionIssued(connection, {
      businessId: input.businessId,
      redemptionId: prepared.reservation.redemptionId,
      shopifyDiscountId: discount.id,
      voucherCode: discount.code,
      expiresAt,
    }));
    await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({
      businessId: input.businessId,
      contactId: input.contactId,
    });
    return issuedResult(base, discount);
  },
};