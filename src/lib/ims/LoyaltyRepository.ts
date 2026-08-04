import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import type {
  LoyaltyAccount,
  LoyaltyChannel,
  LoyaltyMutationResult,
  LoyaltyRedemptionResult,
  LoyaltyReward,
  LoyaltyTransactionType,
} from '@/lib/loyalty/types';
import { calculateProportionalReturnReversal } from '@/lib/loyalty/calculations';
import { imsQuery } from '@/services/IMSMySQLService';

export class LoyaltyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoyaltyValidationError';
  }
}

export class LoyaltyVoidBlockedError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'LoyaltyVoidBlockedError';
  }
}

export class LoyaltyReturnBlockedError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'LoyaltyReturnBlockedError';
  }
}

export class LoyaltyEditBlockedError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'LoyaltyEditBlockedError';
  }
}

interface AccountRow extends RowDataPacket {
  id: number;
  business_id: string;
  contact_id: number;
  balance_points: number;
  lifetime_earned: number;
  lifetime_redeemed: number;
  status: LoyaltyAccount['status'];
}

interface TransactionRow extends RowDataPacket {
  id: number;
  account_id: number;
  contact_id: number;
  type: LoyaltyTransactionType;
  points_delta: number;
  balance_after: number;
}

interface RedemptionRow extends RowDataPacket {
  id: number;
  reward_id: number;
  points_deducted: number;
  value_aud: number;
  status: LoyaltyRedemptionResult['status'];
  transaction_id: number;
  account_id: number;
  balance_after: number;
}

interface RewardRow extends RowDataPacket {
  id: number;
  business_id: string;
  reward_code: string;
  display_name: string;
  description: string | null;
  points_cost: number;
  value_aud: number;
  is_active: number;
  sort_order: number;
}

interface PosSaleEarnRow extends RowDataPacket {
  id: number;
  contact_id: number;
  points_delta: number;
}

interface PosSaleRedemptionRow extends RowDataPacket {
  id: number;
  contact_id: number;
  points_deducted: number;
}

export interface LoyaltyTransactionInput {
  businessId: string;
  contactId: number;
  type: LoyaltyTransactionType;
  pointsDelta: number;
  channel: LoyaltyChannel;
  sourceType?: string | null;
  sourceId?: string | number | null;
  idempotencyKey: string;
  actorId?: string | number | null;
  reason?: string | null;
}

export interface LoyaltyRewardReservationInput {
  businessId: string;
  contactId: number;
  rewardId: number;
  idempotencyKey: string;
  channel: Exclude<LoyaltyChannel, 'migration'>;
  actorId?: string | number | null;
  posSaleId?: number | null;
}

export interface LoyaltyPosSaleReversalResult {
  earnReversals: LoyaltyMutationResult[];
  redemptionReversals: LoyaltyMutationResult[];
}

function mapAccount(row: AccountRow): LoyaltyAccount {
  return {
    id: Number(row.id),
    businessId: row.business_id,
    contactId: Number(row.contact_id),
    balancePoints: Number(row.balance_points),
    lifetimeEarned: Number(row.lifetime_earned),
    lifetimeRedeemed: Number(row.lifetime_redeemed),
    status: row.status,
  };
}

function mapReward(row: RewardRow): LoyaltyReward {
  return {
    id: Number(row.id),
    businessId: row.business_id,
    rewardCode: row.reward_code,
    displayName: row.display_name,
    description: row.description,
    pointsCost: Number(row.points_cost),
    valueAud: Number(row.value_aud),
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order),
  };
}

function validateMutation(input: LoyaltyTransactionInput): void {
  if (!input.businessId.trim()) throw new LoyaltyValidationError('Business context is required.');
  if (!Number.isInteger(input.contactId) || input.contactId <= 0) throw new LoyaltyValidationError('A valid customer is required.');
  if (!Number.isInteger(input.pointsDelta) || input.pointsDelta === 0) throw new LoyaltyValidationError('Points must be a non-zero integer.');
  if (!input.idempotencyKey.trim()) throw new LoyaltyValidationError('An idempotency key is required.');
  if (input.idempotencyKey.length > 191) throw new LoyaltyValidationError('The idempotency key is too long.');

  const mustBePositive = input.type === 'earn' || input.type === 'redeem_reversal';
  const mustBeNegative = input.type === 'redeem' || input.type === 'earn_reversal';
  if (mustBePositive && input.pointsDelta < 0) throw new LoyaltyValidationError(`${input.type} points must be positive.`);
  if (mustBeNegative && input.pointsDelta > 0) throw new LoyaltyValidationError(`${input.type} points must be negative.`);
  if ((input.type === 'adjustment' || input.type.endsWith('_reversal')) && !input.reason?.trim()) {
    throw new LoyaltyValidationError('A reason is required for adjustments and reversals.');
  }
}

async function findTransactionByKey(
  connection: PoolConnection,
  businessId: string,
  idempotencyKey: string,
): Promise<TransactionRow | null> {
  const [rows] = await connection.execute<TransactionRow[]>(
    `SELECT t.id, t.account_id, a.contact_id, t.type, t.points_delta, t.balance_after
       FROM loyalty_transactions t
       JOIN loyalty_accounts a ON a.id = t.account_id AND a.business_id = t.business_id
      WHERE t.business_id = ? AND t.idempotency_key = ?
      LIMIT 1
      FOR UPDATE`,
    [businessId, idempotencyKey],
  );
  return rows[0] ?? null;
}

function replayResult(existing: TransactionRow, input: LoyaltyTransactionInput): LoyaltyMutationResult {
  if (Number(existing.contact_id) !== input.contactId || existing.type !== input.type || Number(existing.points_delta) !== input.pointsDelta) {
    throw new LoyaltyValidationError('The idempotency key was already used for a different loyalty transaction.');
  }
  return {
    transactionId: Number(existing.id),
    accountId: Number(existing.account_id),
    balanceAfter: Number(existing.balance_after),
    duplicate: true,
  };
}

export const LoyaltyRepository = {
  async getMutationByIdempotencyKey(businessId: string, idempotencyKey: string): Promise<LoyaltyMutationResult | null> {
    const rows = await imsQuery<TransactionRow>(
      `SELECT t.id, t.account_id, a.contact_id, t.type, t.points_delta, t.balance_after
         FROM loyalty_transactions t
         JOIN loyalty_accounts a ON a.id = t.account_id AND a.business_id = t.business_id
        WHERE t.business_id = ? AND t.idempotency_key = ?
        LIMIT 1`,
      [businessId, idempotencyKey],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      transactionId: Number(row.id),
      accountId: Number(row.account_id),
      balanceAfter: Number(row.balance_after),
      duplicate: true,
    };
  },

  async getAccount(businessId: string, contactId: number): Promise<LoyaltyAccount | null> {
    const rows = await imsQuery<AccountRow>(
      `SELECT id, business_id, contact_id, balance_points, lifetime_earned, lifetime_redeemed, status
         FROM loyalty_accounts
        WHERE business_id = ? AND contact_id = ?
        LIMIT 1`,
      [businessId, contactId],
    );
    return rows[0] ? mapAccount(rows[0]) : null;
  },

  async listRewards(businessId: string, activeOnly = true): Promise<LoyaltyReward[]> {
    const rows = await imsQuery<RewardRow>(
      `SELECT id, business_id, reward_code, display_name, description, points_cost, value_aud, is_active, sort_order
         FROM loyalty_rewards
        WHERE business_id = ? ${activeOnly ? 'AND is_active = 1' : ''}
        ORDER BY sort_order, points_cost, id`,
      [businessId],
    );
    return rows.map(mapReward);
  },

  async applyTransaction(connection: PoolConnection, input: LoyaltyTransactionInput): Promise<LoyaltyMutationResult> {
    validateMutation(input);
    const isReversal = input.type === 'earn_reversal' || input.type === 'redeem_reversal';

    const existing = await findTransactionByKey(connection, input.businessId, input.idempotencyKey);
    if (existing) return replayResult(existing, input);

    const [contacts] = await connection.execute<RowDataPacket[]>(
      `SELECT id, type, is_active, loyalty_member
         FROM ims_contacts
        WHERE id = ? AND business_id = ?
        LIMIT 1`,
      [input.contactId, input.businessId],
    );
    const contact = contacts[0];
    if (!contact || (!isReversal && !Number(contact.is_active))) throw new LoyaltyValidationError('The selected customer is not active or does not exist.');
    if (!isReversal && (!['retail_customer', 'b2b_customer', 'both'].includes(String(contact.type)) || !Number(contact.loyalty_member))) {
      throw new LoyaltyValidationError('This customer is not enrolled in the loyalty program.');
    }

    if (!isReversal) {
      await connection.execute(
        `INSERT IGNORE INTO loyalty_accounts (business_id, contact_id)
         VALUES (?, ?)`,
        [input.businessId, input.contactId],
      );
    }

    const [accounts] = await connection.execute<AccountRow[]>(
      `SELECT id, business_id, contact_id, balance_points, lifetime_earned, lifetime_redeemed, status
         FROM loyalty_accounts
        WHERE business_id = ? AND contact_id = ?
        LIMIT 1
        FOR UPDATE`,
      [input.businessId, input.contactId],
    );
    const account = accounts[0];
    if (!account) throw new Error(isReversal ? 'The loyalty account to reverse does not exist.' : 'Loyalty account could not be created.');
    if (!isReversal && account.status !== 'active') throw new LoyaltyValidationError('This loyalty account is not active.');

    const replay = await findTransactionByKey(connection, input.businessId, input.idempotencyKey);
    if (replay) return replayResult(replay, input);

    const balanceAfter = Number(account.balance_points) + input.pointsDelta;
    if (balanceAfter < 0) throw new LoyaltyValidationError('The customer does not have enough points.');

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO loyalty_transactions
         (business_id, account_id, type, points_delta, balance_after, channel,
          source_type, source_id, idempotency_key, actor_id, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.businessId,
        account.id,
        input.type,
        input.pointsDelta,
        balanceAfter,
        input.channel,
        input.sourceType ?? null,
        input.sourceId == null ? null : String(input.sourceId),
        input.idempotencyKey,
        input.actorId == null ? null : String(input.actorId),
        input.reason?.trim() || null,
      ],
    );

    const earnedIncrement = input.type === 'earn' ? input.pointsDelta : 0;
    const redeemedIncrement = input.type === 'redeem' ? Math.abs(input.pointsDelta) : 0;
    await connection.execute(
      `UPDATE loyalty_accounts
          SET balance_points = ?,
              lifetime_earned = lifetime_earned + ?,
              lifetime_redeemed = lifetime_redeemed + ?
        WHERE id = ? AND business_id = ?`,
      [balanceAfter, earnedIncrement, redeemedIncrement, account.id, input.businessId],
    );

    return {
      transactionId: Number(result.insertId),
      accountId: Number(account.id),
      balanceAfter,
      duplicate: false,
    };
  },

  async reserveReward(connection: PoolConnection, input: LoyaltyRewardReservationInput): Promise<LoyaltyRedemptionResult> {
    if (!Number.isInteger(input.rewardId) || input.rewardId <= 0) throw new LoyaltyValidationError('A valid reward is required.');
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 191) throw new LoyaltyValidationError('A valid idempotency key is required.');

    const [existingRows] = await connection.execute<RedemptionRow[]>(
      `SELECT r.id, r.reward_id, r.points_deducted, rw.value_aud, r.status, r.transaction_id,
              t.account_id, t.balance_after
         FROM loyalty_redemptions r
        JOIN loyalty_rewards rw ON rw.id = r.reward_id AND rw.business_id = r.business_id
         JOIN loyalty_transactions t ON t.id = r.transaction_id AND t.business_id = r.business_id
         JOIN loyalty_accounts a ON a.id = r.account_id AND a.business_id = r.business_id
        WHERE r.business_id = ? AND r.idempotency_key = ? AND a.contact_id = ?
        LIMIT 1
        FOR UPDATE`,
      [input.businessId, input.idempotencyKey, input.contactId],
    );
    const existing = existingRows[0];
    if (existing) {
      if (Number(existing.reward_id) !== input.rewardId) {
        throw new LoyaltyValidationError('The idempotency key was already used for a different reward.');
      }
      return {
        redemptionId: Number(existing.id),
        rewardId: Number(existing.reward_id),
        pointsDeducted: Number(existing.points_deducted),
        rewardValueAud: Number(existing.value_aud),
        status: existing.status,
        transactionId: Number(existing.transaction_id),
        accountId: Number(existing.account_id),
        balanceAfter: Number(existing.balance_after),
        duplicate: true,
      };
    }

    const [rewardRows] = await connection.execute<RewardRow[]>(
      `SELECT id, business_id, reward_code, display_name, description, points_cost, value_aud, is_active, sort_order
         FROM loyalty_rewards
        WHERE id = ? AND business_id = ? AND is_active = 1
        LIMIT 1
        FOR UPDATE`,
      [input.rewardId, input.businessId],
    );
    const reward = rewardRows[0];
    if (!reward) throw new LoyaltyValidationError('This reward is not available.');
    const pointsCost = Number(reward.points_cost);
    if (!Number.isInteger(pointsCost) || pointsCost <= 0) throw new Error('The reward has an invalid points cost.');

    const transaction = await this.applyTransaction(connection, {
      businessId: input.businessId,
      contactId: input.contactId,
      type: 'redeem',
      pointsDelta: -pointsCost,
      channel: input.channel,
      sourceType: 'loyalty_reward',
      sourceId: input.rewardId,
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
    });

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO loyalty_redemptions
         (business_id, account_id, reward_id, transaction_id, status, points_deducted,
          idempotency_key, pos_sale_id, used_at, actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.businessId,
        transaction.accountId,
        input.rewardId,
        transaction.transactionId,
        input.posSaleId ? 'used' : 'reserved',
        pointsCost,
        input.idempotencyKey,
        input.posSaleId ?? null,
        input.posSaleId ? new Date() : null,
        input.actorId == null ? null : String(input.actorId),
      ],
    );

    return {
      ...transaction,
      redemptionId: Number(result.insertId),
      rewardId: input.rewardId,
      pointsDeducted: pointsCost,
      rewardValueAud: Number(reward.value_aud),
      status: input.posSaleId ? 'used' : 'reserved',
    };
  },

  async reversePosSale(
    connection: PoolConnection,
    input: { businessId: string; saleId: number; actorId?: string | number | null },
  ): Promise<LoyaltyPosSaleReversalResult> {
    const [redemptions] = await connection.execute<PosSaleRedemptionRow[]>(
      `SELECT r.id, a.contact_id, r.points_deducted
         FROM loyalty_redemptions r
         JOIN loyalty_accounts a ON a.id = r.account_id AND a.business_id = r.business_id
        WHERE r.business_id = ? AND r.pos_sale_id = ? AND r.status = 'used'
        ORDER BY r.id
        FOR UPDATE`,
      [input.businessId, input.saleId],
    );
    const redemptionReversals: LoyaltyMutationResult[] = [];
    for (const redemption of redemptions) {
      const reversal = await this.applyTransaction(connection, {
        businessId: input.businessId,
        contactId: Number(redemption.contact_id),
        type: 'redeem_reversal',
        pointsDelta: Number(redemption.points_deducted),
        channel: 'pos',
        sourceType: 'pos_sale_void',
        sourceId: input.saleId,
        idempotencyKey: `pos:sale:${input.saleId}:redemption:${redemption.id}:void`,
        actorId: input.actorId,
        reason: `POS sale ${input.saleId} voided`,
      });
      await connection.execute(
        `UPDATE loyalty_redemptions
            SET status = 'cancelled', cancelled_at = NOW(), cancelled_reason = ?
          WHERE id = ? AND business_id = ? AND status = 'used'`,
        [`POS sale ${input.saleId} voided`, redemption.id, input.businessId],
      );
      redemptionReversals.push(reversal);
    }

    const [earns] = await connection.execute<PosSaleEarnRow[]>(
      `SELECT t.id, a.contact_id, t.points_delta
         FROM loyalty_transactions t
         JOIN loyalty_accounts a ON a.id = t.account_id AND a.business_id = t.business_id
        WHERE t.business_id = ? AND t.type = 'earn'
          AND t.source_type = 'pos_sale' AND t.source_id = ?
        ORDER BY t.id
        FOR UPDATE`,
      [input.businessId, String(input.saleId)],
    );
    const [editRows] = await connection.execute<RowDataPacket[]>(
      `SELECT points_delta
         FROM loyalty_transactions
        WHERE business_id = ? AND source_type = 'pos_sale_edit' AND source_id = ?
        ORDER BY id
        FOR UPDATE`,
      [input.businessId, String(input.saleId)],
    );
    const editDelta = editRows.reduce((sum, row) => sum + Number(row.points_delta), 0);
    const earnReversals: LoyaltyMutationResult[] = [];
    for (const [index, earn] of earns.entries()) {
      const netEarned = Math.max(0, Number(earn.points_delta) + (index === 0 ? editDelta : 0));
      if (netEarned === 0) continue;
      try {
        earnReversals.push(await this.applyTransaction(connection, {
          businessId: input.businessId,
          contactId: Number(earn.contact_id),
          type: 'earn_reversal',
          pointsDelta: -netEarned,
          channel: 'pos',
          sourceType: 'pos_sale_void',
          sourceId: input.saleId,
          idempotencyKey: `pos:sale:${input.saleId}:earn:${earn.id}:void`,
          actorId: input.actorId,
          reason: `POS sale ${input.saleId} voided`,
        }));
      } catch (error) {
        if (error instanceof LoyaltyValidationError && error.message === 'The customer does not have enough points.') {
          throw new LoyaltyVoidBlockedError('This sale earned points that have since been spent. Reverse the later loyalty activity before voiding this sale.');
        }
        throw error;
      }
    }

    return { earnReversals, redemptionReversals };
  },

  async reversePosReturn(
    connection: PoolConnection,
    input: {
      businessId: string;
      originalSaleId: number;
      returnSaleId: number;
      originalEligibleCents: number;
      cumulativeReturnedCents: number;
      actorId?: string | number | null;
    },
  ): Promise<LoyaltyMutationResult | null> {
    const [earns] = await connection.execute<PosSaleEarnRow[]>(
      `SELECT t.id, a.contact_id, t.points_delta
         FROM loyalty_transactions t
         JOIN loyalty_accounts a ON a.id = t.account_id AND a.business_id = t.business_id
        WHERE t.business_id = ? AND t.type = 'earn'
          AND t.source_type = 'pos_sale' AND t.source_id = ?
        ORDER BY t.id
        FOR UPDATE`,
      [input.businessId, String(input.originalSaleId)],
    );
    const earn = earns[0];
    if (!earn) return null;

    const [editRows] = await connection.execute<RowDataPacket[]>(
      `SELECT points_delta
         FROM loyalty_transactions
        WHERE business_id = ? AND source_type = 'pos_sale_edit' AND source_id = ?
        ORDER BY id
        FOR UPDATE`,
      [input.businessId, String(input.originalSaleId)],
    );
    const netEarned = Math.max(
      0,
      Number(earn.points_delta) + editRows.reduce((sum, row) => sum + Number(row.points_delta), 0),
    );

    const [reversalRows] = await connection.execute<RowDataPacket[]>(
      `SELECT points_delta
         FROM loyalty_transactions
        WHERE business_id = ? AND type = 'earn_reversal'
          AND source_type = 'pos_sale_return' AND source_id = ?
        ORDER BY id
        FOR UPDATE`,
      [input.businessId, String(input.originalSaleId)],
    );
    const alreadyReversed = reversalRows.reduce((sum, row) => sum + Math.abs(Number(row.points_delta)), 0);
    const points = calculateProportionalReturnReversal({
      originalEarned: netEarned,
      originalEligibleCents: input.originalEligibleCents,
      cumulativeReturnedCents: input.cumulativeReturnedCents,
      alreadyReversed,
    });
    if (points <= 0) return null;

    try {
      return await this.applyTransaction(connection, {
        businessId: input.businessId,
        contactId: Number(earn.contact_id),
        type: 'earn_reversal',
        pointsDelta: -points,
        channel: 'pos',
        sourceType: 'pos_sale_return',
        sourceId: input.originalSaleId,
        idempotencyKey: `pos:return:${input.returnSaleId}:earn:${earn.id}`,
        actorId: input.actorId,
        reason: `Linked POS return ${input.returnSaleId} for sale ${input.originalSaleId}`,
      });
    } catch (error) {
      if (error instanceof LoyaltyValidationError && error.message === 'The customer does not have enough points.') {
        throw new LoyaltyReturnBlockedError('This return would reverse loyalty points that the customer has already spent. Reverse the later loyalty activity before completing this return.');
      }
      throw error;
    }
  },

  async reconcilePosSaleEarn(
    connection: PoolConnection,
    input: {
      businessId: string;
      saleId: number;
      targetPoints: number;
      actorId?: string | number | null;
    },
  ): Promise<LoyaltyMutationResult | null> {
    const [earns] = await connection.execute<PosSaleEarnRow[]>(
      `SELECT t.id, a.contact_id, t.points_delta
         FROM loyalty_transactions t
         JOIN loyalty_accounts a ON a.id = t.account_id AND a.business_id = t.business_id
        WHERE t.business_id = ? AND t.type = 'earn'
          AND t.source_type = 'pos_sale' AND t.source_id = ?
        ORDER BY t.id
        FOR UPDATE`,
      [input.businessId, String(input.saleId)],
    );
    const originalEarn = earns[0];
    if (!originalEarn) return null;

    const [editRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, points_delta
         FROM loyalty_transactions
        WHERE business_id = ? AND source_type = 'pos_sale_edit' AND source_id = ?
        ORDER BY id
        FOR UPDATE`,
      [input.businessId, String(input.saleId)],
    );
    const currentPoints = Number(originalEarn.points_delta)
      + editRows.reduce((sum, row) => sum + Number(row.points_delta), 0);
    const targetPoints = Math.max(0, Math.floor(Number(input.targetPoints) || 0));
    const pointsDelta = targetPoints - currentPoints;
    if (pointsDelta === 0) return null;

    try {
      return await this.applyTransaction(connection, {
        businessId: input.businessId,
        contactId: Number(originalEarn.contact_id),
        type: pointsDelta > 0 ? 'earn' : 'earn_reversal',
        pointsDelta,
        channel: 'pos',
        sourceType: 'pos_sale_edit',
        sourceId: input.saleId,
        idempotencyKey: `pos:sale:${input.saleId}:edit:${editRows.length + 1}:earn`,
        actorId: input.actorId,
        reason: `Manager edit recalculated POS sale ${input.saleId} earning to ${targetPoints} points`,
      });
    } catch (error) {
      if (error instanceof LoyaltyValidationError && error.message === 'The customer does not have enough points.') {
        throw new LoyaltyEditBlockedError('This edit would remove loyalty points that the customer has already spent. Reverse the later loyalty activity before editing this sale.');
      }
      throw error;
    }
  },
};
