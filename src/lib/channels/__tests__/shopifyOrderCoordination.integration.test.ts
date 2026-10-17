import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installOnlineSyncTenantSchema, onlineSyncTableDdl, ONLINE_SYNC_ORDER_COLUMNS } from '../../../../scripts/online-sync-schema.mjs';
import type { OnlineSyncSql } from '../onlineSyncJobs';
import {
  claimShopifyOrderSnapshot, completeShopifyOrderSnapshot, releaseShopifyOrderLease,
  renewShopifyOrderLease, runShopifyOrderEffect, type ShopifyOrderLease,
} from '../shopifyOrderCoordination';

vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: vi.fn(), imsQuery: vi.fn(), imsExecute: vi.fn() }));

const port = Number(process.env.ONLINE_SYNC_TEST_PORT);
const password = process.env.ONLINE_SYNC_TEST_PASSWORD ?? '';
const schema = `online_order_test_${randomUUID().replaceAll('-', '')}`;
const snapshot = { businessId: 'alpha', channelInstanceId: 'store', externalOrderId: '123',
  updatedAt: '2026-10-17T01:00:00.000Z', hash: 'a'.repeat(64) };
let pool: Pool;
let sql: OnlineSyncSql;

async function claim(required = ['order_record'], source = snapshot): Promise<ShopifyOrderLease> {
  const result = await claimShopifyOrderSnapshot(source, required, sql);
  if (result.status !== 'ready') throw new Error(`Expected a ready isolated order claim, got ${result.status}.`);
  return result.lease;
}

async function localWrite(connection: PoolConnection) {
  await connection.execute(
    `INSERT INTO test_order_effect_writes (effect_key, executions) VALUES ('order_record', 1)
     ON DUPLICATE KEY UPDATE executions = executions + 1`,
  );
  return { status: 'applied' as const, referenceId: '44' };
}

describe.skipIf(!port)('Shopify order coordination on real MySQL (loopback only)', () => {
  beforeAll(async () => {
    if (!Number.isSafeInteger(port) || port <= 0) throw new Error('Explicit local MySQL test port required.');
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try { await server.query(`CREATE DATABASE \`${schema}\``); } finally { await server.end(); }
    pool = mysql.createPool({
      host: '127.0.0.1', port, user: 'root', password, database: schema,
      connectionLimit: 6, timezone: 'Z', dateStrings: true,
    });
    const connections = await Promise.all(Array.from({ length: 6 }, () => pool.getConnection()));
    try { await Promise.all(connections.map(connection => connection.query("SET time_zone = '+11:00'"))); }
    finally { connections.forEach(connection => connection.release()); }
    sql = {
      query: async (statement, params) => {
        const [rows] = await pool.execute<RowDataPacket[]>(statement, params);
        return rows;
      },
      execute: async (statement, params) => {
        const [result] = await pool.execute<ResultSetHeader>(statement, params);
        return result;
      },
    };
    const canonical = await readFile(path.join(process.cwd(), 'scripts', 'ims-schema.sql'), 'utf8');
    await pool.query(onlineSyncTableDdl(canonical, 'ims_sales_channel_jobs'));
    let oldOrderDdl = onlineSyncTableDdl(canonical, 'ims_shopify_order_recovery');
    for (const column of Object.keys(ONLINE_SYNC_ORDER_COLUMNS)) {
      oldOrderDdl = oldOrderDdl.replace(new RegExp(`^  ${column}\\s+[^\\n]*\\n`, 'gm'), '');
    }
    await pool.query(oldOrderDdl);
    const connection = await pool.getConnection();
    try { await installOnlineSyncTenantSchema(connection); } finally { connection.release(); }
    await pool.query(`CREATE TABLE test_order_effect_writes (
      effect_key VARCHAR(100) PRIMARY KEY, executions INT NOT NULL
    ) ENGINE=InnoDB`);
  }, 60_000);

  beforeEach(async () => {
    await pool.query('DELETE FROM test_order_effect_writes');
    await pool.query('DELETE FROM ims_sales_channel_jobs');
    await pool.query('DELETE FROM ims_shopify_order_recovery');
    await pool.query('DELETE FROM ims_online_sync_control');
    await pool.query(`INSERT INTO ims_online_sync_control (business_id, rollout_state, paused)
      VALUES ('alpha','validation',0),('other','cutover',0),('legacy','legacy',0),('paused','cutover',1)`);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try {
      if (!/^online_order_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe isolated schema cleanup target.');
      await server.query(`DROP DATABASE \`${schema}\``);
    } finally { await server.end(); }
  });

  it('upgrades the old order table and reruns without changing rollout controls', async () => {
    await pool.query(`INSERT INTO ims_shopify_order_recovery
      (business_id,channel_instance_id,external_order_id,effects_json,review_reason)
      VALUES ('alpha','store','123','{"retained":"historical-state"}','source_conflict')`);
    await pool.query('ALTER TABLE ims_shopify_order_recovery DROP COLUMN lease_token, DROP COLUMN lease_expires_at');
    const connection = await pool.getConnection();
    try {
      await installOnlineSyncTenantSchema(connection);
      await installOnlineSyncTenantSchema(connection);
    } finally { connection.release(); }
    const [columns] = await pool.query<RowDataPacket[]>(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ims_shopify_order_recovery'",
    );
    expect(columns.map(row => row.COLUMN_NAME)).toEqual(expect.arrayContaining(Object.keys(ONLINE_SYNC_ORDER_COLUMNS)));
    const [orders] = await pool.query<RowDataPacket[]>('SELECT effects_json, review_reason FROM ims_shopify_order_recovery');
    const retained = typeof orders[0].effects_json === 'string' ? JSON.parse(orders[0].effects_json) : orders[0].effects_json;
    expect(retained).toEqual({ retained: 'historical-state' });
    expect(orders[0].review_reason).toBe('source_conflict');
    const [rows] = await pool.query<RowDataPacket[]>('SELECT business_id, rollout_state, paused FROM ims_online_sync_control ORDER BY business_id');
    expect(rows).toEqual([
      { business_id: 'alpha', rollout_state: 'validation', paused: 0 },
      { business_id: 'legacy', rollout_state: 'legacy', paused: 0 },
      { business_id: 'other', rollout_state: 'cutover', paused: 0 },
      { business_id: 'paused', rollout_state: 'cutover', paused: 1 },
    ]);
  });

  it('allows one concurrent owner of one order, without a business-wide webhook lock', async () => {
    const claims = await Promise.all(Array.from({ length: 12 }, () =>
      claimShopifyOrderSnapshot(snapshot, ['order_record'], sql)));
    expect(claims.filter(result => result.status === 'ready')).toHaveLength(1);
    expect(claims.filter(result => result.status === 'busy')).toHaveLength(11);
    await expect(claimShopifyOrderSnapshot({ ...snapshot, externalOrderId: '124' }, ['order_record'], sql))
      .resolves.toMatchObject({ status: 'ready' });
  });

  it('uses exact business, storefront and order ownership and never activates legacy or paused owners', async () => {
    await claim();
    for (const source of [
      { ...snapshot, businessId: 'other' },
      { ...snapshot, channelInstanceId: 'other' },
    ]) await expect(claimShopifyOrderSnapshot(source, ['order_record'], sql)).resolves.toMatchObject({ status: 'ready' });
    for (const businessId of ['ALPHA', 'legacy', 'paused', 'missing']) {
      await expect(claimShopifyOrderSnapshot({ ...snapshot, businessId }, ['order_record'], sql))
        .resolves.toEqual({ status: 'busy' });
    }
    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM ims_shopify_order_recovery');
    expect(rows[0].count).toBe(3);
  });

  it('atomically deduplicates concurrent local mutations through a locked effect receipt', async () => {
    const lease = await claim();
    const results = await Promise.all(Array.from({ length: 6 }, () =>
      runShopifyOrderEffect(lease, 'order_record', localWrite, pool)));
    expect(results.filter(result => !result.duplicate)).toHaveLength(1);
    const [writes] = await pool.query<RowDataPacket[]>('SELECT executions FROM test_order_effect_writes');
    expect(writes).toEqual([{ executions: 1 }]);
  });

  it('rolls back both the domain write and receipt on a thrown local failure, then retries', async () => {
    const lease = await claim();
    await expect(runShopifyOrderEffect(lease, 'order_record', async connection => {
      await localWrite(connection);
      throw new Error('Interrupted local write');
    }, pool)).rejects.toThrow('Interrupted local write');
    const [writes] = await pool.query<RowDataPacket[]>('SELECT executions FROM test_order_effect_writes');
    expect(writes).toEqual([]);
    await expect(runShopifyOrderEffect(lease, 'order_record', localWrite, pool)).resolves.toMatchObject({ duplicate: false });
  });

  it('retains committed receipts across a released/reclaimed worker without repeating domain writes', async () => {
    const lease = await claim();
    await runShopifyOrderEffect(lease, 'order_record', localWrite, pool);
    await releaseShopifyOrderLease(lease, sql);
    const successor = await claim();
    expect(successor.token).not.toBe(lease.token);
    await expect(runShopifyOrderEffect(successor, 'order_record', localWrite, pool)).resolves.toMatchObject({ duplicate: true });
    await completeShopifyOrderSnapshot(successor, pool);
    await expect(claimShopifyOrderSnapshot(snapshot, ['order_record'], sql)).resolves.toEqual({ status: 'duplicate' });
    const [writes] = await pool.query<RowDataPacket[]>('SELECT executions FROM test_order_effect_writes');
    expect(writes).toEqual([{ executions: 1 }]);
  });

  it('prevents an expired owner from mutating, completing, renewing or clearing its successor', async () => {
    const old = await claim();
    await pool.query('UPDATE ims_shopify_order_recovery SET lease_expires_at = TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3))');
    const successor = await claim();
    const apply = vi.fn(localWrite);
    await expect(runShopifyOrderEffect(old, 'order_record', apply, pool)).rejects.toThrow('no longer owned');
    await expect(completeShopifyOrderSnapshot(old, pool)).rejects.toThrow('no longer owned');
    await expect(renewShopifyOrderLease(old, sql)).rejects.toThrow('no longer owned');
    await releaseShopifyOrderLease(old, sql);
    expect(apply).not.toHaveBeenCalled();
    await expect(runShopifyOrderEffect(successor, 'order_record', localWrite, pool)).resolves.toMatchObject({ duplicate: false });
  });

  it('rejects a forged source version or a newly paused owner before local mutation', async () => {
    const lease = await claim();
    const apply = vi.fn(localWrite);
    await expect(runShopifyOrderEffect({ ...lease, hash: 'b'.repeat(64) }, 'order_record', apply, pool))
      .rejects.toThrow('no longer owned');
    await pool.query("UPDATE ims_online_sync_control SET paused=1 WHERE business_id='alpha'");
    await expect(runShopifyOrderEffect(lease, 'order_record', apply, pool)).rejects.toThrow('no longer owned');
    await expect(completeShopifyOrderSnapshot(lease, pool)).rejects.toThrow('no longer owned');
    expect(apply).not.toHaveBeenCalled();
  });

  it('rolls back a mutation whose lease expires before its receipt can commit', async () => {
    const lease = await claim();
    await pool.query('UPDATE ims_shopify_order_recovery SET lease_expires_at = TIMESTAMPADD(SECOND,1,UTC_TIMESTAMP(3))');
    await expect(runShopifyOrderEffect(lease, 'order_record', async connection => {
      await localWrite(connection);
      await connection.query('DO SLEEP(1.2)');
      return { status: 'applied' };
    }, pool)).rejects.toThrow('no longer owned');
    const [writes] = await pool.query<RowDataPacket[]>('SELECT executions FROM test_order_effect_writes');
    expect(writes).toEqual([]);
    const successor = await claim();
    await expect(runShopifyOrderEffect(successor, 'order_record', localWrite, pool)).resolves.toMatchObject({ duplicate: false });
  });

  it('never advances applied version with an unfinished local effect', async () => {
    const lease = await claim(['order_record', 'loyalty']);
    await runShopifyOrderEffect(lease, 'order_record', localWrite, pool);
    await expect(completeShopifyOrderSnapshot(lease, pool)).rejects.toThrow('unfinished local effects');
    const [rows] = await pool.query<RowDataPacket[]>('SELECT provider_updated_at, applied_hash FROM ims_shopify_order_recovery');
    expect(rows).toEqual([{ provider_updated_at: null, applied_hash: null }]);
  });

  it('requires a durable exact-owner job before accepting an accounting handoff', async () => {
    const lease = await claim();
    await pool.query(`INSERT INTO ims_sales_channel_jobs
      (business_id,channel_instance_id,provider,operation,operation_key,available_at)
      VALUES ('other','store','shopify','shopify_order_apply','refund:81',UTC_TIMESTAMP(3))`);
    await expect(runShopifyOrderEffect(lease, 'order_record', async () => ({
      status: 'queued', operation: 'shopify_order_apply', operationKey: 'refund:81',
    }), pool)).rejects.toThrow('not durably queued');
    await runShopifyOrderEffect(lease, 'order_record', async connection => {
      await connection.execute(
        `INSERT INTO ims_sales_channel_jobs
          (business_id,channel_instance_id,provider,operation,operation_key,available_at)
         VALUES ('alpha','store','shopify','shopify_order_apply','refund:81',UTC_TIMESTAMP(3))`,
      );
      return { status: 'queued', operation: 'shopify_order_apply', operationKey: 'refund:81' };
    }, pool);
    await completeShopifyOrderSnapshot(lease, pool);
    const [jobs] = await pool.query<RowDataPacket[]>("SELECT status, operation_key FROM ims_sales_channel_jobs WHERE business_id='alpha'");
    expect(jobs).toEqual([{ status: 'pending', operation_key: 'refund:81' }]);
  });

  it('rejects older snapshots and quarantines equal-version conflicting data durably', async () => {
    const lease = await claim();
    await runShopifyOrderEffect(lease, 'order_record', localWrite, pool);
    await completeShopifyOrderSnapshot(lease, pool);
    await expect(claimShopifyOrderSnapshot({ ...snapshot, updatedAt: '2026-10-17T00:59:59Z' }, ['order_record'], sql))
      .resolves.toEqual({ status: 'stale' });
    await expect(claimShopifyOrderSnapshot({ ...snapshot, hash: 'b'.repeat(64) }, ['order_record'], sql))
      .resolves.toEqual({ status: 'review', reason: 'provider_version_conflict' });
    await expect(claimShopifyOrderSnapshot(snapshot, ['order_record'], sql))
      .resolves.toEqual({ status: 'review', reason: 'provider_version_conflict' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT applied_hash, lease_token FROM ims_shopify_order_recovery');
    expect(rows).toEqual([{ applied_hash: snapshot.hash, lease_token: null }]);
  });

  it('preserves partial effects for review if the provider snapshot changes before completion', async () => {
    const lease = await claim(['order_record', 'loyalty']);
    await runShopifyOrderEffect(lease, 'order_record', localWrite, pool);
    await releaseShopifyOrderLease(lease, sql);
    await expect(claimShopifyOrderSnapshot({
      ...snapshot, updatedAt: '2026-10-17T01:01:00Z', hash: 'b'.repeat(64),
    }, ['order_record', 'loyalty'], sql)).resolves.toEqual({ status: 'review', reason: 'unfinished_snapshot_changed' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT effects_json, applied_hash FROM ims_shopify_order_recovery');
    const effects = typeof rows[0].effects_json === 'string' ? JSON.parse(rows[0].effects_json) : rows[0].effects_json;
    expect(effects.effects.order_record).toEqual({ status: 'applied', referenceId: '44' });
    expect(rows[0].applied_hash).toBeNull();
  });

  it('can abandon a discovered version for a newer one when no local effect committed', async () => {
    const lease = await claim();
    await releaseShopifyOrderLease(lease, sql);
    await expect(claimShopifyOrderSnapshot({
      ...snapshot, updatedAt: '2026-10-17T01:01:00Z', hash: 'b'.repeat(64),
    }, ['order_record'], sql)).resolves.toMatchObject({ status: 'ready' });
    const [writes] = await pool.query<RowDataPacket[]>('SELECT executions FROM test_order_effect_writes');
    expect(writes).toEqual([]);
  });

  it('advances an unchanged completed version without repeating domain writes or dropping handoff receipts', async () => {
    const lease = await claim();
    await runShopifyOrderEffect(lease, 'order_record', localWrite, pool);
    await completeShopifyOrderSnapshot(lease, pool);
    await expect(claimShopifyOrderSnapshot({
      ...snapshot, updatedAt: '2026-10-17T01:01:00Z',
    }, ['order_record'], sql)).resolves.toEqual({ status: 'duplicate' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT provider_updated_at, lease_token FROM ims_shopify_order_recovery');
    expect(rows).toEqual([{ provider_updated_at: '2026-10-17 01:01:00.000', lease_token: null }]);
    const [writes] = await pool.query<RowDataPacket[]>('SELECT executions FROM test_order_effect_writes');
    expect(writes).toEqual([{ executions: 1 }]);
  });

  it('retains partial receipts across a newer version with identical functional inputs', async () => {
    const lease = await claim(['order_record', 'loyalty']);
    await runShopifyOrderEffect(lease, 'order_record', localWrite, pool);
    await releaseShopifyOrderLease(lease, sql);
    const successor = await claim(['order_record', 'loyalty'], { ...snapshot, updatedAt: '2026-10-17T01:01:00Z' });
    await expect(runShopifyOrderEffect(successor, 'order_record', localWrite, pool)).resolves.toMatchObject({ duplicate: true });
    await runShopifyOrderEffect(successor, 'loyalty', async () => ({ status: 'not_required' }), pool);
    await completeShopifyOrderSnapshot(successor, pool);
    const [writes] = await pool.query<RowDataPacket[]>('SELECT executions FROM test_order_effect_writes');
    expect(writes).toEqual([{ executions: 1 }]);
  });

  it('recovers a crash after the final receipt but before snapshot completion without repeating its effects', async () => {
    const lease = await claim();
    await runShopifyOrderEffect(lease, 'order_record', localWrite, pool);
    await releaseShopifyOrderLease(lease, sql);
    await expect(claimShopifyOrderSnapshot({
      ...snapshot, updatedAt: '2026-10-17T01:01:00Z', hash: 'b'.repeat(64),
    }, ['order_record'], sql)).resolves.toMatchObject({ status: 'ready' });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT provider_updated_at, applied_hash FROM ims_shopify_order_recovery');
    expect(rows).toEqual([{ provider_updated_at: '2026-10-17 01:00:00.000', applied_hash: snapshot.hash }]);
    const [writes] = await pool.query<RowDataPacket[]>('SELECT executions FROM test_order_effect_writes');
    expect(writes).toEqual([{ executions: 1 }]);
  });

  it('accepts a strictly newer snapshot only after its predecessor completed, and stores applied time in UTC', async () => {
    const lease = await claim();
    await runShopifyOrderEffect(lease, 'order_record', localWrite, pool);
    await completeShopifyOrderSnapshot(lease, pool);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT provider_updated_at FROM ims_shopify_order_recovery');
    expect(rows[0].provider_updated_at).toBe('2026-10-17 01:00:00.000');
    await expect(claimShopifyOrderSnapshot({
      ...snapshot, updatedAt: '2026-10-17T01:01:00Z', hash: 'b'.repeat(64),
    }, ['order_record'], sql)).resolves.toMatchObject({ status: 'ready' });
  });
});
