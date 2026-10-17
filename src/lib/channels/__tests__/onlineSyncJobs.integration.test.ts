import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installOnlineSyncMainSchema, installOnlineSyncTenantSchema, onlineSyncTableDdl,
  ONLINE_SYNC_BATCH_COLUMNS, ONLINE_SYNC_JOB_COLUMNS, ONLINE_SYNC_ORDER_COLUMNS,
} from '../../../../scripts/online-sync-schema.mjs';
import {
  assertOnlineSyncLease, checkpointOnlineSyncJob, claimOnlineSyncBusiness, claimOnlineSyncJob,
  enqueueOnlineSyncJob, failOnlineSyncJob, finishOnlineSyncJob, releaseOnlineSyncBusiness,
  renewOnlineSyncBusiness, renewOnlineSyncJob, yieldOnlineSyncJob,
  type OnlineSyncBusinessLease, type OnlineSyncJobLease, type OnlineSyncSql,
} from '../onlineSyncJobs';

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: vi.fn(), imsExecute: vi.fn() }));

const port = Number(process.env.ONLINE_SYNC_TEST_PORT);
const password = process.env.ONLINE_SYNC_TEST_PASSWORD ?? '';
const schema = `online_sync_test_${randomUUID().replaceAll('-', '')}`;
let pool: Pool;
let sql: OnlineSyncSql;
const continuation = {
  window: { phase: 'baseline' as const, from: '2026-07-01T00:00:00Z', to: '2026-10-17T01:00:00Z' },
  pageInfo: 'first', remaining: [{ id: '123', updatedAt: '2026-10-17T00:30:00.000Z' }],
  nextPageInfo: 'second', pageLoaded: true,
};
async function business(): Promise<OnlineSyncBusinessLease> {
  const lease = await claimOnlineSyncBusiness('alpha', sql);
  if (!lease) throw new Error('Expected isolated business lease.');
  return lease;
}
async function job(lease: OnlineSyncBusinessLease): Promise<OnlineSyncJobLease> {
  const input = {
    businessId: 'alpha', channelInstanceId: 'store', provider: 'shopify' as const,
    operation: 'shopify_order_reconcile' as const, operationKey: 'reconcile',
  };
  await enqueueOnlineSyncJob(input, sql);
  const claimed = await claimOnlineSyncJob({ ...input, business: lease }, sql);
  if (!claimed) throw new Error('Expected isolated reconciliation lease.');
  return claimed;
}

describe.skipIf(!port)('online sync real MySQL fencing (loopback only)', () => {
  beforeAll(async () => {
    if (!Number.isSafeInteger(port) || port <= 0) throw new Error('Explicit local MySQL test port required.');
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try { await server.query(`CREATE DATABASE \`${schema}\``); } finally { await server.end(); }
    pool = mysql.createPool({
      host: '127.0.0.1', port, user: 'root', password, database: schema,
      connectionLimit: 6, timezone: 'Z', dateStrings: true,
    });
    sql = {
      query: async (statement, params) => {
        const connection = await pool.getConnection();
        try {
          await connection.query("SET time_zone = '+11:00'");
          const [rows] = await connection.execute<RowDataPacket[]>(statement, params);
          return rows;
        } finally { connection.release(); }
      },
      execute: async (statement, params) => {
        const connection = await pool.getConnection();
        try {
          await connection.query("SET time_zone = '+11:00'");
          const [result] = await connection.execute<ResultSetHeader>(statement, params);
          return result;
        } finally { connection.release(); }
      },
    };
    const canonical = await readFile(path.join(process.cwd(), 'scripts', 'ims-schema.sql'), 'utf8');
    let jobsDdl = onlineSyncTableDdl(canonical, 'ims_sales_channel_jobs');
    for (const column of Object.keys(ONLINE_SYNC_JOB_COLUMNS)) {
      jobsDdl = jobsDdl.replace(new RegExp(`^  ${column}\\s+[^\\n]*\\n`, 'gm'), '');
    }
    await pool.query(jobsDdl);
    const main = await readFile(path.join(process.cwd(), 'scripts', 'setup-xero-tables.sql'), 'utf8');
    let batchDdl = onlineSyncTableDdl(main, 'xero_online_batches');
    for (const column of Object.keys(ONLINE_SYNC_BATCH_COLUMNS)) {
      batchDdl = batchDdl.replace(new RegExp(`^  ${column}\\s+[^\\n]*\\n`, 'gm'), '');
    }
    batchDdl = batchDdl.replace(/^  INDEX idx_xero_online_sync_due[^\n]*\n/gm, '').replace(/,\s*\n\) ENGINE/, '\n) ENGINE');
    await pool.query(batchDdl);
    const connection = await pool.getConnection();
    try {
      await installOnlineSyncTenantSchema(connection);
      await installOnlineSyncMainSchema(connection);
    } finally { connection.release(); }
  }, 60_000);

  beforeEach(async () => {
    await pool.query('DELETE FROM ims_sales_channel_jobs');
    await pool.query('DELETE FROM ims_online_sync_control');
    await pool.query("INSERT INTO ims_online_sync_control (business_id, rollout_state) VALUES ('alpha','validation'),('legacy','legacy'),('paused','cutover')");
    await pool.query("UPDATE ims_online_sync_control SET paused=1 WHERE business_id='paused'");
  });

  afterAll(async () => {
    if (pool) await pool.end();
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try {
      if (!/^online_sync_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe isolated schema cleanup target.');
      await server.query(`DROP DATABASE \`${schema}\``);
    } finally { await server.end(); }
  });

  it('installs canonical columns idempotently without activating or changing rollout state', async () => {
    const connection = await pool.getConnection();
    try {
      await installOnlineSyncTenantSchema(connection);
      await installOnlineSyncMainSchema(connection);
      for (const [table, columns] of [
        ['ims_sales_channel_jobs', ONLINE_SYNC_JOB_COLUMNS],
        ['ims_shopify_order_recovery', ONLINE_SYNC_ORDER_COLUMNS],
        ['xero_online_batches', ONLINE_SYNC_BATCH_COLUMNS],
      ] as const) {
        const [rows] = await connection.query<RowDataPacket[]>(
          'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table],
        );
        expect(rows.map(row => row.COLUMN_NAME)).toEqual(expect.arrayContaining(Object.keys(columns)));
      }
      const [controls] = await connection.query<RowDataPacket[]>('SELECT business_id, rollout_state, paused FROM ims_online_sync_control ORDER BY business_id');
      expect(controls).toEqual([
        { business_id: 'alpha', rollout_state: 'validation', paused: 0 },
        { business_id: 'legacy', rollout_state: 'legacy', paused: 0 },
        { business_id: 'paused', rollout_state: 'cutover', paused: 1 },
      ]);
    } finally { connection.release(); }
  });

  it('allows exactly one business-wide claimant across concurrent connections', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => claimOnlineSyncBusiness('alpha', sql)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await claimOnlineSyncBusiness('ALPHA', sql)).toBeNull();
    expect(await claimOnlineSyncBusiness('legacy', sql)).toBeNull();
    expect(await claimOnlineSyncBusiness('paused', sql)).toBeNull();
    expect(await claimOnlineSyncBusiness('missing', sql)).toBeNull();
  });

  it('allows only one job owner and does not touch other operations sharing the ledger', async () => {
    const lease = await business();
    const input = {
      business: lease, businessId: 'alpha', channelInstanceId: 'store', provider: 'shopify' as const,
      operation: 'shopify_order_reconcile' as const, operationKey: 'reconcile',
    };
    await enqueueOnlineSyncJob(input, sql);
    await pool.query("INSERT INTO ims_sales_channel_jobs (business_id,channel_instance_id,provider,operation,operation_key) VALUES ('alpha','store','shopify','inventory_sync','inventory')");
    const results = await Promise.all(Array.from({ length: 6 }, () => claimOnlineSyncJob(input, sql)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const [rows] = await pool.query<RowDataPacket[]>("SELECT status, attempts, lease_token FROM ims_sales_channel_jobs WHERE operation='inventory_sync'");
    expect(rows[0]).toEqual({ status: 'pending', attempts: 0, lease_token: null });
  });

  it('retains discovery and remaining orders after yield and restart', async () => {
    const lease = await business();
    const first = await job(lease);
    await checkpointOnlineSyncJob(first, continuation, sql);
    await yieldOnlineSyncJob(first, sql);
    await releaseOnlineSyncBusiness(lease, sql);
    const second = await job(await business());
    expect(second.continuation).toMatchObject({ remaining: continuation.remaining, pageInfo: 'first', nextPageInfo: 'second' });
    expect(second.token).not.toBe(first.token);
    await expect(checkpointOnlineSyncJob(first, continuation, sql)).rejects.toThrow('no longer owned');
  });

  it('reclaims expired leases without letting the stale worker renew, complete or checkpoint', async () => {
    const firstBusiness = await business();
    const first = await job(firstBusiness);
    await checkpointOnlineSyncJob(first, continuation, sql);
    await pool.query("UPDATE ims_online_sync_control SET lease_expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE business_id='alpha'");
    await pool.query("UPDATE ims_sales_channel_jobs SET lease_expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE business_id='alpha'");
    const successor = await job(await business());
    expect(successor.continuation?.remaining).toEqual(continuation.remaining);
    await expect(renewOnlineSyncBusiness(firstBusiness, sql)).rejects.toThrow('no longer owned');
    await expect(renewOnlineSyncJob(first, sql)).rejects.toThrow('no longer owned');
    await expect(finishOnlineSyncJob(first, null, sql)).rejects.toThrow('no longer owned');
    await expect(failOnlineSyncJob(first, 'operational_failure', 0, 0, sql)).rejects.toThrow('no longer owned');
    await releaseOnlineSyncBusiness(firstBusiness, sql);
    await assertOnlineSyncLease(successor, sql);
    await renewOnlineSyncJob(successor, sql);
  });

  it('honours a pause immediately and cannot revive an expired job with a valid business token', async () => {
    const lease = await business();
    const first = await job(lease);
    await pool.query("UPDATE ims_sales_channel_jobs SET lease_expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND)");
    await expect(renewOnlineSyncJob(first, sql)).rejects.toThrow('no longer owned');
    const second = await job(lease);
    await pool.query("UPDATE ims_online_sync_control SET paused=1 WHERE business_id='alpha'");
    await expect(assertOnlineSyncLease(second, sql)).rejects.toThrow('no longer owned');
    await expect(checkpointOnlineSyncJob(second, continuation, sql)).rejects.toThrow('no longer owned');
  });

  it('preserves the failed cursor and provider retry delay without a permanent attempt limit', async () => {
    const lease = await business();
    const first = await job(lease);
    await checkpointOnlineSyncJob(first, continuation, sql);
    await failOnlineSyncJob({ ...first, attempts: 99 }, 'provider_rate_limit', 0, 7200, sql);
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT status, payload_json, safe_error, TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(3),available_at) AS delay FROM ims_sales_channel_jobs',
    );
    expect(rows[0]).toMatchObject({ status: 'failed', safe_error: 'provider_rate_limit' });
    expect(Number(rows[0].delay)).toBeGreaterThanOrEqual(7198);
    expect(rows[0].payload_json).not.toBeNull();
    expect(await claimOnlineSyncJob(first, sql)).toBeNull();
  });

  it('clears a finished interval and schedules the next run without rerunning it immediately', async () => {
    const lease = await business();
    const first = await job(lease);
    await checkpointOnlineSyncJob(first, continuation, sql);
    await finishOnlineSyncJob(first, new Date(Date.now() + 900_000).toISOString(), sql);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT status,payload_json,attempts,lease_token FROM ims_sales_channel_jobs');
    expect(rows[0]).toEqual({ status: 'pending', payload_json: null, attempts: 0, lease_token: null });
    expect(await claimOnlineSyncJob(first, sql)).toBeNull();
  });
});
