import type { PoolConnection } from 'mysql2/promise';

import {
  LoyaltyRepository,
  LoyaltyValidationError,
  type LoyaltyRewardReservationInput,
  type LoyaltyTransactionInput,
} from '@/lib/ims/LoyaltyRepository';
import { parseLoyaltySettings } from '@/lib/loyalty/calculations';
import { LOYALTY_SETTING_KEYS, type LoyaltyMutationResult, type LoyaltyRedemptionResult, type LoyaltySettings } from '@/lib/loyalty/types';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool, imsQuery } from '@/services/IMSMySQLService';

export const LoyaltyService = {
  async getSettings(businessId: string): Promise<LoyaltySettings> {
    const keys = Object.values(LOYALTY_SETTING_KEYS);
    const placeholders = keys.map(() => '?').join(',');
    const rows = await imsQuery<{ key: string; value: string }>(
      `SELECT \`key\`, value
         FROM ims_settings
        WHERE business_id = ? AND \`key\` IN (${placeholders})`,
      [businessId, ...keys],
    );
    return parseLoyaltySettings(Object.fromEntries(rows.map(row => [row.key, row.value])));
  },

  applyTransaction(connection: PoolConnection, input: LoyaltyTransactionInput): Promise<LoyaltyMutationResult> {
    return LoyaltyRepository.applyTransaction(connection, input);
  },

  reserveReward(connection: PoolConnection, input: LoyaltyRewardReservationInput): Promise<LoyaltyRedemptionResult> {
    return LoyaltyRepository.reserveReward(connection, input);
  },

  async recordTransaction(input: LoyaltyTransactionInput): Promise<LoyaltyMutationResult> {
    const pool = getIMSPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await LoyaltyRepository.applyTransaction(connection, input);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      if (!(error instanceof LoyaltyValidationError)) {
        await reportRuntimeIssue({
          businessId: input.businessId,
          source: 'loyalty',
          operation: 'record_transaction',
          title: 'Loyalty transaction failed',
          error,
          context: {
            contactId: input.contactId,
            transactionType: input.type,
            channel: input.channel,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
          },
          reference: input.sourceId == null ? undefined : { type: input.sourceType || 'loyalty_source', id: input.sourceId },
        });
      }
      throw error;
    } finally {
      connection.release();
    }
  },
};