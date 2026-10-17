import { randomUUID } from 'node:crypto';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { parseOnlineSyncWorkPayload, type OnlineSyncWorkPayload } from './onlineSyncPayload';
import {
  ONLINE_SYNC_LIMITS, OnlineSyncLeaseLostError, OnlineSyncValidationError,
  onlineSyncRetrySeconds, onlineSyncTimestamp, parseReconciliationContinuation,
  type ReconciliationContinuation,
} from './onlineSyncPolicy';

export type OnlineSyncOperation = 'shopify_order_reconcile' | 'shopify_order_apply' | 'online_daily_accounting';
export type OnlineSyncFailureCode =
  | 'provider_unavailable' | 'provider_rate_limit' | 'source_conflict'
  | 'history_unavailable' | 'unknown_external_result' | 'operational_failure'
  | 'awaiting_reconciliation' | 'rebaseline_required' | 'accounting_review_required'
  | 'gift_card_review_required' | 'order_review_required' | 'configuration_blocked';

export type OnlineSyncSqlValue = string | number | boolean | Date | null;
export interface OnlineSyncSql {
  query(sql: string, params: OnlineSyncSqlValue[]): Promise<Record<string, unknown>[]>;
  execute(sql: string, params: OnlineSyncSqlValue[]): Promise<{ affectedRows: number }>;
}
const defaultSql: OnlineSyncSql = {
  query: (sql, params) => imsQuery<Record<string, unknown>>(sql, params),
  execute: (sql, params) => imsExecute(sql, params),
};

export interface OnlineSyncBusinessLease {
  businessId: string;
  token: string;
}
export interface OnlineSyncJobLease {
  business: OnlineSyncBusinessLease;
  channelInstanceId: string;
  provider: 'shopify' | 'native_shop';
  operation: OnlineSyncOperation;
  operationKey: string;
  token: string;
  attempts: number;
  continuation: ReconciliationContinuation | null;
  payload?: OnlineSyncWorkPayload | null;
}

const businessFence = `control.business_id = ? AND control.lease_token = ?
  AND control.lease_expires_at > UTC_TIMESTAMP(3) AND control.paused = 0
  AND control.rollout_state IN ('validation','cutover')`;
const jobFence = `job.business_id = ? AND job.channel_instance_id = ? AND job.provider = ?
  AND job.operation = ? AND job.operation_key = ? AND job.lease_token = ?
  AND job.status = 'processing' AND job.lease_expires_at > UTC_TIMESTAMP(3)`;

function owner(businessId: string, channelInstanceId?: string): void {
  if (!businessId.trim() || businessId.length > 100
    || (channelInstanceId !== undefined && (!channelInstanceId.trim() || channelInstanceId.length > 36))) {
    throw new OnlineSyncValidationError('An exact online sync owner is required.');
  }
}

function businessParams(lease: OnlineSyncBusinessLease): OnlineSyncSqlValue[] {
  owner(lease.businessId);
  if (!lease.token) throw new OnlineSyncValidationError('A business lease token is required.');
  return [lease.businessId, lease.token];
}

function jobParams(lease: OnlineSyncJobLease): OnlineSyncSqlValue[] {
  return [
    lease.business.businessId, lease.channelInstanceId, lease.provider,
    lease.operation, lease.operationKey, lease.token,
  ];
}

export async function claimOnlineSyncBusiness(
  businessId: string,
  sql: OnlineSyncSql = defaultSql,
): Promise<OnlineSyncBusinessLease | null> {
  owner(businessId);
  const token = randomUUID();
  const claimed = await sql.execute(
    `UPDATE ims_online_sync_control
        SET lease_token = ?, lease_expires_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
            last_run_at = UTC_TIMESTAMP(3)
      WHERE business_id = ? AND paused = 0 AND rollout_state IN ('validation','cutover')
        AND (lease_token IS NULL OR lease_expires_at <= UTC_TIMESTAMP(3))`,
    [token, ONLINE_SYNC_LIMITS.leaseSeconds, businessId],
  );
  return claimed.affectedRows === 1 ? { businessId, token } : null;
}

export async function renewOnlineSyncBusiness(
  lease: OnlineSyncBusinessLease,
  sql: OnlineSyncSql = defaultSql,
): Promise<void> {
  const result = await sql.execute(
    `UPDATE ims_online_sync_control control
        SET lease_expires_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
      WHERE ${businessFence}`,
    [ONLINE_SYNC_LIMITS.leaseSeconds, ...businessParams(lease)],
  );
  if (result.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
}

export async function releaseOnlineSyncBusiness(
  lease: OnlineSyncBusinessLease,
  sql: OnlineSyncSql = defaultSql,
): Promise<void> {
  await sql.execute(
    `UPDATE ims_online_sync_control SET lease_token = NULL, lease_expires_at = NULL
      WHERE business_id = ? AND lease_token = ?`,
    businessParams(lease),
  );
}

export async function enqueueOnlineSyncJob(input: {
  businessId: string;
  channelInstanceId: string;
  provider: 'shopify' | 'native_shop';
  operation: OnlineSyncOperation;
  operationKey: string;
  payload?: OnlineSyncWorkPayload;
}, sql: OnlineSyncSql = defaultSql): Promise<void> {
  owner(input.businessId, input.channelInstanceId);
  if (!input.operationKey.trim() || input.operationKey.length > 191) {
    throw new OnlineSyncValidationError('Invalid online sync operation key.');
  }
  await sql.execute(
    `INSERT IGNORE INTO ims_sales_channel_jobs
       (business_id, channel_instance_id, provider, operation, operation_key, available_at, payload_json)
     SELECT ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ? FROM ims_online_sync_control
      WHERE business_id = ? AND rollout_state IN ('validation','cutover') AND paused = 0`,
    [input.businessId, input.channelInstanceId, input.provider, input.operation, input.operationKey,
      input.payload ? JSON.stringify(parseOnlineSyncWorkPayload(input.payload)) : null, input.businessId],
  );
}

export async function claimOnlineSyncJob(input: {
  business: OnlineSyncBusinessLease;
  channelInstanceId: string;
  provider: 'shopify' | 'native_shop';
  operation: OnlineSyncOperation;
  operationKey: string;
}, sql: OnlineSyncSql = defaultSql): Promise<OnlineSyncJobLease | null> {
  owner(input.business.businessId, input.channelInstanceId);
  const token = randomUUID();
  const identity = [input.business.businessId, input.channelInstanceId, input.provider, input.operation, input.operationKey];
  const result = await sql.execute(
    `UPDATE ims_sales_channel_jobs job
       JOIN ims_online_sync_control control ON control.business_id = job.business_id
        SET job.status = 'processing', job.attempts = job.attempts + 1,
            job.lease_token = ?, job.lease_expires_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
            job.locked_at = UTC_TIMESTAMP(3), job.safe_error = NULL
      WHERE job.business_id = ? AND job.channel_instance_id = ? AND job.provider = ?
        AND job.operation = ? AND job.operation_key = ?
        AND (
          (job.status IN ('pending','failed') AND job.available_at <= UTC_TIMESTAMP(3))
          OR (job.status = 'processing' AND job.lease_expires_at <= UTC_TIMESTAMP(3))
        ) AND ${businessFence}`,
    [token, ONLINE_SYNC_LIMITS.leaseSeconds, ...identity, ...businessParams(input.business)],
  );
  if (result.affectedRows !== 1) return null;
  const lease = { ...input, token };
  const rows = await sql.query(
    `SELECT job.attempts, job.payload_json
       FROM ims_sales_channel_jobs job
       JOIN ims_online_sync_control control ON control.business_id = job.business_id
      WHERE ${jobFence} AND ${businessFence}`,
    [...jobParams({ ...lease, attempts: 0, continuation: null }), ...businessParams(input.business)],
  );
  if (rows.length !== 1) throw new OnlineSyncLeaseLostError();
  const attempts = Number(rows[0].attempts);
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new OnlineSyncValidationError('Invalid persisted online sync attempt count.');
  }
  try {
    const raw = rows[0].payload_json;
    const decoded: unknown = raw === null ? null : typeof raw === 'string' ? JSON.parse(raw) : raw;
    const continuation = decoded === null || input.operation !== 'shopify_order_reconcile'
      ? null : parseReconciliationContinuation(decoded);
    const payload = decoded === null || input.operation === 'shopify_order_reconcile'
      ? null : parseOnlineSyncWorkPayload(decoded);
    if (!payload && input.operation !== 'shopify_order_reconcile') {
      throw new OnlineSyncValidationError('Recovery work has no validated payload.');
    }
    return { ...lease, attempts, continuation, ...(payload ? { payload } : {}) };
  } catch (error) {
    await failOnlineSyncJob({ ...lease, attempts, continuation: null }, 'source_conflict', 0, 0, sql);
    throw error;
  }
}

export async function saveOnlineSyncWorkPayload(
  lease: OnlineSyncJobLease,
  payload: OnlineSyncWorkPayload,
  sql: OnlineSyncSql = defaultSql,
): Promise<void> {
  if (lease.operation === 'shopify_order_reconcile') throw new OnlineSyncValidationError('Wrong recovery payload operation.');
  const saved = await sql.execute(
    `UPDATE ims_sales_channel_jobs job
       JOIN ims_online_sync_control control ON control.business_id = job.business_id
        SET job.payload_json = ?
      WHERE ${jobFence} AND ${businessFence}`,
    [JSON.stringify(parseOnlineSyncWorkPayload(payload)), ...jobParams(lease), ...businessParams(lease.business)],
  );
  if (saved.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
}

export async function assertOnlineSyncLease(
  lease: OnlineSyncJobLease,
  sql: OnlineSyncSql = defaultSql,
): Promise<void> {
  const rows = await sql.query(
    `SELECT 1 AS owned FROM ims_sales_channel_jobs job
       JOIN ims_online_sync_control control ON control.business_id = job.business_id
      WHERE ${jobFence} AND ${businessFence} FOR UPDATE`,
    [...jobParams(lease), ...businessParams(lease.business)],
  );
  if (rows.length !== 1) throw new OnlineSyncLeaseLostError();
}

export async function renewOnlineSyncJob(
  lease: OnlineSyncJobLease,
  sql: OnlineSyncSql = defaultSql,
): Promise<void> {
  await renewOnlineSyncBusiness(lease.business, sql);
  const result = await sql.execute(
    `UPDATE ims_sales_channel_jobs job
       JOIN ims_online_sync_control control ON control.business_id = job.business_id
        SET job.lease_expires_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
      WHERE ${jobFence} AND ${businessFence}`,
    [ONLINE_SYNC_LIMITS.leaseSeconds, ...jobParams(lease), ...businessParams(lease.business)],
  );
  if (result.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
}

export async function checkpointOnlineSyncJob(
  lease: OnlineSyncJobLease,
  continuation: ReconciliationContinuation,
  sql: OnlineSyncSql = defaultSql,
): Promise<void> {
  const payload = JSON.stringify(parseReconciliationContinuation(continuation));
  const result = await sql.execute(
    `UPDATE ims_sales_channel_jobs job
       JOIN ims_online_sync_control control ON control.business_id = job.business_id
        SET job.payload_json = ?
      WHERE ${jobFence} AND ${businessFence}`,
    [payload, ...jobParams(lease), ...businessParams(lease.business)],
  );
  if (result.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
}

export async function finishOnlineSyncJob(
  lease: OnlineSyncJobLease,
  nextEligibleAt: string | null,
  sql: OnlineSyncSql = defaultSql,
): Promise<void> {
  if (nextEligibleAt !== null) onlineSyncTimestamp(nextEligibleAt);
  const result = await sql.execute(
    `UPDATE ims_sales_channel_jobs job
       JOIN ims_online_sync_control control ON control.business_id = job.business_id
        SET job.status = ?, job.available_at = ?, job.payload_json = NULL,
            job.attempts = 0, job.safe_error = NULL,
            job.completed_at = UTC_TIMESTAMP(3), job.locked_at = NULL,
            job.lease_token = NULL, job.lease_expires_at = NULL
      WHERE ${jobFence} AND ${businessFence}`,
    [
      nextEligibleAt === null ? 'complete' : 'pending',
      nextEligibleAt === null ? new Date(0) : new Date(nextEligibleAt),
      ...jobParams(lease), ...businessParams(lease.business),
    ],
  );
  if (result.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
}

export async function yieldOnlineSyncJob(
  lease: OnlineSyncJobLease,
  sql: OnlineSyncSql = defaultSql,
): Promise<void> {
  const result = await sql.execute(
    `UPDATE ims_sales_channel_jobs job
       JOIN ims_online_sync_control control ON control.business_id = job.business_id
        SET job.status = 'pending', job.available_at = UTC_TIMESTAMP(3),
            job.locked_at = NULL, job.lease_token = NULL, job.lease_expires_at = NULL
      WHERE ${jobFence} AND ${businessFence}`,
    [...jobParams(lease), ...businessParams(lease.business)],
  );
  if (result.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
}

export async function failOnlineSyncJob(
  lease: OnlineSyncJobLease,
  code: OnlineSyncFailureCode,
  jitter: number,
  retryAfterSeconds = 0,
  sql: OnlineSyncSql = defaultSql,
): Promise<void> {
  const seconds = onlineSyncRetrySeconds(lease.attempts, jitter, retryAfterSeconds);
  const result = await sql.execute(
    `UPDATE ims_sales_channel_jobs job
       JOIN ims_online_sync_control control ON control.business_id = job.business_id
        SET job.status = 'failed', job.available_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
            job.safe_error = ?, job.locked_at = NULL, job.lease_token = NULL, job.lease_expires_at = NULL
      WHERE ${jobFence} AND ${businessFence}`,
    [seconds, code, ...jobParams(lease), ...businessParams(lease.business)],
  );
  if (result.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
}
