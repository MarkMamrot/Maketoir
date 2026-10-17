import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getIMSPool, imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { ONLINE_SYNC_LIMITS, OnlineSyncLeaseLostError, OnlineSyncValidationError, onlineSyncTimestamp } from './onlineSyncPolicy';
import type { OnlineSyncSql, OnlineSyncSqlValue } from './onlineSyncJobs';
import { validateShopifyOrderSnapshot, type ShopifyOrderSnapshot } from './shopifyOrderSnapshot';
import { markOnlineDayChanged } from './shopifyRecoveryDayFacts';

export type ShopifyOrderEffectResult =
  | { status: 'applied' | 'not_required'; referenceId?: string }
  | { status: 'queued'; operation: 'shopify_order_apply' | 'online_daily_accounting'; operationKey: string };

interface OrderEffects {
  version: 1;
  snapshot: { updatedAt: string; hash: string };
  required: string[];
  completed: boolean;
  effects: Record<string, ShopifyOrderEffectResult>;
}

export interface ShopifyOrderLease extends ShopifyOrderSnapshot {
  token: string;
}
export type ShopifyOrderClaim =
  | { status: 'ready'; lease: ShopifyOrderLease }
  | { status: 'busy' | 'stale' | 'duplicate' }
  | { status: 'review'; reason: string };

const defaultSql: OnlineSyncSql = {
  query: (sql, params) => imsQuery<Record<string, unknown>>(sql, params),
  execute: (sql, params) => imsExecute(sql, params),
};
const fence = `recovery.business_id = ? AND recovery.channel_instance_id = ? AND recovery.external_order_id = ?
  AND recovery.lease_token = ? AND recovery.lease_expires_at > UTC_TIMESTAMP(3)
  AND control.paused = 0 AND control.rollout_state IN ('validation','cutover')`;
const joinedTables = `ims_shopify_order_recovery recovery
  JOIN ims_online_sync_control control ON control.business_id = recovery.business_id`;

function params(lease: ShopifyOrderLease): OnlineSyncSqlValue[] {
  validateShopifyOrderSnapshot(lease);
  if (!lease.token) throw new OnlineSyncValidationError('A Shopify order lease token is required.');
  return [lease.businessId, lease.channelInstanceId, lease.externalOrderId, lease.token];
}

function effectKey(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,49}(?::[1-9]\d{0,99})?$/.test(value)) {
    throw new OnlineSyncValidationError('Invalid Shopify order effect key.');
  }
  return value;
}

function requiredEffects(keys: readonly string[]): string[] {
  if (!keys.length || keys.length > 1000 || new Set(keys).size !== keys.length) {
    throw new OnlineSyncValidationError('A bounded, unique Shopify effect plan is required.');
  }
  return keys.map(effectKey).sort();
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OnlineSyncValidationError('Invalid persisted Shopify order effects.');
  }
  return value as Record<string, unknown>;
}

function result(value: unknown): ShopifyOrderEffectResult {
  const raw = object(value);
  if (raw.status === 'applied' || raw.status === 'not_required') {
    if (raw.referenceId !== undefined && (typeof raw.referenceId !== 'string'
      || !/^[a-zA-Z0-9_-]{1,100}$/.test(raw.referenceId))) {
      throw new OnlineSyncValidationError('Invalid Shopify effect reference.');
    }
    return raw.referenceId === undefined ? { status: raw.status } : { status: raw.status, referenceId: raw.referenceId };
  }
  if (raw.status === 'queued'
    && (raw.operation === 'shopify_order_apply' || raw.operation === 'online_daily_accounting')
    && typeof raw.operationKey === 'string' && raw.operationKey.trim()
    && raw.operationKey.length <= 191) {
    return { status: 'queued', operation: raw.operation, operationKey: raw.operationKey };
  }
  throw new OnlineSyncValidationError('Invalid Shopify effect result.');
}

function parseEffects(value: unknown): OrderEffects | null {
  if (value === null) return null;
  const raw = object(typeof value === 'string' ? JSON.parse(value) : value);
  const snapshot = object(raw.snapshot);
  if (raw.version !== 1 || typeof raw.completed !== 'boolean' || !Array.isArray(raw.required)
    || !raw.required.every((key): key is string => typeof key === 'string')
    || typeof snapshot.updatedAt !== 'string' || typeof snapshot.hash !== 'string'
    || !/^[a-f0-9]{64}$/.test(snapshot.hash)) {
    throw new OnlineSyncValidationError('Invalid persisted Shopify order effect plan.');
  }
  onlineSyncTimestamp(snapshot.updatedAt);
  const required = requiredEffects(raw.required);
  const effects = Object.fromEntries(Object.entries(object(raw.effects)).map(([key, value]) => {
    if (!required.includes(effectKey(key))) throw new OnlineSyncValidationError('Unplanned Shopify order effect.');
    return [key, result(value)];
  }));
  if (raw.completed && required.some(key => !Object.hasOwn(effects, key))) {
    throw new OnlineSyncValidationError('Completed Shopify snapshot has unfinished effects.');
  }
  return { version: 1, snapshot: { updatedAt: snapshot.updatedAt, hash: snapshot.hash }, required,
    completed: raw.completed, effects };
}

function assertSnapshot(state: OrderEffects | null, lease: ShopifyOrderLease): asserts state is OrderEffects {
  if (!state || state.snapshot.hash !== lease.hash
    || onlineSyncTimestamp(state.snapshot.updatedAt) !== onlineSyncTimestamp(lease.updatedAt) || state.completed) {
    throw new OnlineSyncLeaseLostError();
  }
}

function appliedTimestamp(value: unknown): number | null {
  if (value === null) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  if (typeof value === 'string') {
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)
      ? `${value.replace(' ', 'T')}Z` : value;
    return onlineSyncTimestamp(normalized);
  }
  throw new OnlineSyncValidationError('Invalid applied Shopify order timestamp.');
}

export async function releaseShopifyOrderLease(lease: ShopifyOrderLease, sql: OnlineSyncSql = defaultSql): Promise<void> {
  await sql.execute(
    `UPDATE ims_shopify_order_recovery recovery SET lease_token = NULL, lease_expires_at = NULL
      WHERE recovery.business_id = ? AND recovery.channel_instance_id = ? AND recovery.external_order_id = ?
        AND recovery.lease_token = ?`, params(lease),
  );
}

export async function claimShopifyOrderSnapshot(
  snapshot: ShopifyOrderSnapshot,
  required: readonly string[],
  sql: OnlineSyncSql = defaultSql,
): Promise<ShopifyOrderClaim> {
  validateShopifyOrderSnapshot(snapshot);
  const plan = requiredEffects(required);
  const identity = [snapshot.businessId, snapshot.channelInstanceId, snapshot.externalOrderId];
  await sql.execute(
    `INSERT INTO ims_shopify_order_recovery (business_id, channel_instance_id, external_order_id)
     SELECT ?, ?, ? FROM ims_online_sync_control
      WHERE business_id = ? AND paused = 0 AND rollout_state IN ('validation','cutover')
     ON DUPLICATE KEY UPDATE external_order_id = ims_shopify_order_recovery.external_order_id`,
    [...identity, snapshot.businessId],
  );
  const lease = { ...snapshot, token: randomUUID() };
  const claimed = await sql.execute(
    `UPDATE ${joinedTables}
        SET recovery.lease_token = ?, recovery.lease_expires_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
      WHERE recovery.business_id = ? AND recovery.channel_instance_id = ? AND recovery.external_order_id = ?
        AND (recovery.lease_token IS NULL OR recovery.lease_expires_at <= UTC_TIMESTAMP(3))
        AND control.paused = 0 AND control.rollout_state IN ('validation','cutover')`,
    [lease.token, ONLINE_SYNC_LIMITS.leaseSeconds, ...identity],
  );
  if (claimed.affectedRows !== 1) return { status: 'busy' };
  let retained = false;
  try {
    const rows = await sql.query(
      `SELECT recovery.effects_json, recovery.review_reason, recovery.provider_updated_at, recovery.applied_hash
         FROM ${joinedTables} WHERE ${fence}`, params(lease),
    );
    if (rows.length !== 1) throw new OnlineSyncLeaseLostError();
    if (rows[0].review_reason !== null) {
      if (typeof rows[0].review_reason !== 'string' || !/^[a-z_]{1,64}$/.test(rows[0].review_reason)) {
        throw new OnlineSyncValidationError('Invalid Shopify order review reason.');
      }
      return { status: 'review', reason: rows[0].review_reason };
    }
    const state = parseEffects(rows[0].effects_json);
    const appliedAt = appliedTimestamp(rows[0].provider_updated_at);
    const appliedHash = rows[0].applied_hash;
    if ((appliedAt === null) !== (appliedHash === null)
      || (!state && appliedAt !== null)
      || (state?.completed && (appliedAt !== onlineSyncTimestamp(state.snapshot.updatedAt) || appliedHash !== state.snapshot.hash))
      || (state && !state.completed && appliedAt !== null
        && appliedAt >= onlineSyncTimestamp(state.snapshot.updatedAt))) {
      throw new OnlineSyncValidationError('Inconsistent applied Shopify order version.');
    }
    let reason: string | null = null;
    if (state) {
      const difference = onlineSyncTimestamp(snapshot.updatedAt) - onlineSyncTimestamp(state.snapshot.updatedAt);
      if (difference < 0) return { status: 'stale' };
      if (difference > 0 && !state.completed && state.required.every(key => Object.hasOwn(state.effects, key))) {
        state.completed = true;
        const saved = await sql.execute(
          `UPDATE ${joinedTables}
              SET recovery.provider_updated_at = ?, recovery.applied_hash = ?, recovery.effects_json = ?
            WHERE ${fence}`,
          [new Date(onlineSyncTimestamp(state.snapshot.updatedAt)).toISOString().slice(0, 23).replace('T', ' '),
            state.snapshot.hash, JSON.stringify(state), ...params(lease)],
        );
        if (saved.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
      }
      if (difference === 0) {
        if (snapshot.hash !== state.snapshot.hash) reason = 'provider_version_conflict';
        else if (JSON.stringify(plan) !== JSON.stringify(state.required)) reason = 'effect_plan_changed';
        else if (state.completed) return { status: 'duplicate' };
        else {
          retained = true;
          return { status: 'ready', lease };
        }
      } else if (snapshot.hash === state.snapshot.hash && JSON.stringify(plan) === JSON.stringify(state.required)) {
        state.snapshot.updatedAt = snapshot.updatedAt;
        const saved = await sql.execute(
          `UPDATE ${joinedTables}
              SET recovery.effects_json = ?,
                  recovery.provider_updated_at = IF(?, ?, recovery.provider_updated_at)
            WHERE ${fence}`,
          [JSON.stringify(state), state.completed,
            new Date(onlineSyncTimestamp(snapshot.updatedAt)).toISOString().slice(0, 23).replace('T', ' '),
            ...params(lease)],
        );
        if (saved.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
        if (state.completed) return { status: 'duplicate' };
        retained = true;
        return { status: 'ready', lease };
      } else if (!state.completed && Object.keys(state.effects).length) reason = 'unfinished_snapshot_changed';
    }
    if (reason) {
      const saved = await sql.execute(
        `UPDATE ${joinedTables} SET recovery.review_reason = ? WHERE ${fence}`, [reason, ...params(lease)],
      );
      if (saved.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
      return { status: 'review', reason };
    }
    const next: OrderEffects = { version: 1, snapshot: { updatedAt: snapshot.updatedAt, hash: snapshot.hash },
      required: plan, completed: false, effects: {} };
    const saved = await sql.execute(
      `UPDATE ${joinedTables} SET recovery.effects_json = ? WHERE ${fence}`, [JSON.stringify(next), ...params(lease)],
    );
    if (saved.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
    retained = true;
    return { status: 'ready', lease };
  } finally {
    if (!retained) await releaseShopifyOrderLease(lease, sql);
  }
}

export async function renewShopifyOrderLease(lease: ShopifyOrderLease, sql: OnlineSyncSql = defaultSql): Promise<void> {
  const updated = await sql.execute(
    `UPDATE ${joinedTables}
        SET recovery.lease_expires_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)) WHERE ${fence}`,
    [ONLINE_SYNC_LIMITS.leaseSeconds, ...params(lease)],
  );
  if (updated.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
}

async function lockedEffects(connection: PoolConnection, lease: ShopifyOrderLease): Promise<OrderEffects> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT recovery.effects_json FROM ${joinedTables}
      WHERE ${fence} AND recovery.review_reason IS NULL FOR UPDATE`, params(lease),
  );
  if (rows.length !== 1) throw new OnlineSyncLeaseLostError();
  const state = parseEffects(rows[0].effects_json);
  assertSnapshot(state, lease);
  return state;
}

// Local SQL only: domain writes and their receipt commit together, with no provider call or idle pooled connection.
export async function runShopifyOrderEffect(
  lease: ShopifyOrderLease,
  key: string,
  apply: (connection: PoolConnection) => Promise<ShopifyOrderEffectResult>,
  pool: Pick<Pool, 'getConnection'> = getIMSPool(),
): Promise<{ duplicate: boolean; result: ShopifyOrderEffectResult }> {
  effectKey(key);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const state = await lockedEffects(connection, lease);
    if (!state.required.includes(key)) throw new OnlineSyncValidationError('Unplanned Shopify order effect.');
    if (Object.hasOwn(state.effects, key)) {
      await connection.commit();
      return { duplicate: true, result: state.effects[key] };
    }

    const applied = result(await apply(connection));
    if (applied.status === 'queued') {
      const [jobs] = await connection.execute<RowDataPacket[]>(
        `SELECT operation_key FROM ims_sales_channel_jobs
          WHERE business_id = ? AND channel_instance_id = ? AND provider = 'shopify'
            AND operation = ? AND operation_key = ? FOR UPDATE`,
        [lease.businessId, lease.channelInstanceId, applied.operation, applied.operationKey],
      );
      if (jobs.length !== 1) throw new OnlineSyncValidationError('Shopify effect handoff is not durably queued.');
    }
    state.effects[key] = applied;
    const [saved] = await connection.execute<ResultSetHeader>(
      `UPDATE ${joinedTables} SET recovery.effects_json = ? WHERE ${fence} AND recovery.review_reason IS NULL`,
      [JSON.stringify(state), ...params(lease)],
    );
    if (saved.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
    await connection.commit();
    return { duplicate: false, result: applied };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function quarantineShopifyOrderSnapshot(
  lease: ShopifyOrderLease,
  businessDate: string,
  reason: 'historical_stock_evidence_missing' | 'unsupported_fulfilment_history'
    | import('@/lib/ims/shopifyOrderReview').ShopifyOrderReviewRequiredError['reason'],
  pool: Pick<Pool, 'getConnection'> = getIMSPool(),
): Promise<void> {
  onlineSyncTimestamp(`${businessDate}T00:00:00.000Z`);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockedEffects(connection, lease);
    await markOnlineDayChanged(connection, lease, businessDate, reason);
    const [saved] = await connection.execute<ResultSetHeader>(
      `UPDATE ${joinedTables} SET recovery.review_reason = ? WHERE ${fence} AND recovery.review_reason IS NULL`,
      [reason, ...params(lease)],
    );
    if (saved.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function completeShopifyOrderSnapshot(
  lease: ShopifyOrderLease,
  pool: Pick<Pool, 'getConnection'> = getIMSPool(),
): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const state = await lockedEffects(connection, lease);
    if (state.required.some(key => !Object.hasOwn(state.effects, key))) {
      throw new OnlineSyncValidationError('Shopify order still has unfinished local effects or handoffs.');
    }
    state.completed = true;
    const [saved] = await connection.execute<ResultSetHeader>(
      `UPDATE ${joinedTables}
          SET recovery.provider_updated_at = ?, recovery.applied_hash = ?, recovery.effects_json = ?,
              recovery.lease_token = NULL, recovery.lease_expires_at = NULL
        WHERE ${fence} AND recovery.review_reason IS NULL`,
      [new Date(onlineSyncTimestamp(lease.updatedAt)).toISOString().slice(0, 23).replace('T', ' '),
        lease.hash, JSON.stringify(state), ...params(lease)],
    );
    if (saved.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
