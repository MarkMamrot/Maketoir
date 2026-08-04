import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import type {
  LoyaltyAccount,
  LoyaltyChannel,
  LoyaltyMutationResult,
  LoyaltyRedemptionResult,
  LoyaltyReward,
  LoyaltyTransactionType,
} from '@/lib/loyalty/types';
import { imsQuery } from '@/services/IMSMySQLService';

export class LoyaltyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoyaltyValidationError';
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

    const existing = await findTransactionByKey(connection, input.businessId, input.idempotencyKey);
    if (existing) return replayResult(existing, input);

    const [contacts] = await connection.execute<RowDataPacket[]>(
      'SELECT id FROM ims_contacts WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1',
      [input.contactId, input.businessId],
    );
    if (!contacts[0]) throw new LoyaltyValidationError('The selected customer is not active or does not exist.');

    await connection.execute(
      `INSERT IGNORE INTO loyalty_accounts (business_id, contact_id)
       VALUES (?, ?)`,
      [input.businessId, input.contactId],
    );

    const [accounts] = await connection.execute<AccountRow[]>(
      `SELECT id, business_id, contact_id, balance_points, lifetime_earned, lifetime_redeemed, status
         FROM loyalty_accounts
        WHERE business_id = ? AND contact_id = ?
        LIMIT 1
        FOR UPDATE`,
      [input.businessId, input.contactId],
    );
    const account = accounts[0];
    if (!account) throw new Error('Loyalty account could not be created.');
    if (account.status !== 'active') throw new LoyaltyValidationError('This loyalty account is not active.');

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
      `SELECT r.id, r.reward_id, r.points_deducted, r.status, r.transaction_id,
              t.account_id, t.balance_after
         FROM loyalty_redemptions r
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
         (business_id, account_id, reward_id, transaction_id, status, points_deducted, idempotency_key, actor_id)
       VALUES (?, ?, ?, ?, 'reserved', ?, ?, ?)`,
      [
        input.businessId,
        transaction.accountId,
        input.rewardId,
        transaction.transactionId,
        pointsCost,
        input.idempotencyKey,
        input.actorId == null ? null : String(input.actorId),
      ],
    );

    return {
      ...transaction,
      redemptionId: Number(result.insertId),
      rewardId: input.rewardId,
      pointsDeducted: pointsCost,
      status: 'reserved',
    };
  },
};
