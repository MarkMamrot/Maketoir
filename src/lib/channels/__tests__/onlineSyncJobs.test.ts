import { describe, expect, it, vi } from 'vitest';
import {
  assertOnlineSyncLease, checkpointOnlineSyncJob, claimOnlineSyncBusiness, claimOnlineSyncJob,
  enqueueOnlineSyncJob, failOnlineSyncJob, finishOnlineSyncJob, releaseOnlineSyncBusiness,
  renewOnlineSyncBusiness, renewOnlineSyncJob, yieldOnlineSyncJob,
  type OnlineSyncJobLease, type OnlineSyncSql,
} from '../onlineSyncJobs';

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: vi.fn(), imsExecute: vi.fn() }));

const business = { businessId: 'business', token: 'business-token' };
const job: OnlineSyncJobLease = {
  business, channelInstanceId: 'store', provider: 'shopify', operation: 'shopify_order_reconcile',
  operationKey: 'reconcile', token: 'job-token', attempts: 2, continuation: null,
};
const continuation = {
  window: { phase: 'incremental' as const, from: '2026-10-17T00:00:00Z', to: '2026-10-17T01:00:00Z' },
  pageInfo: null, remaining: [], nextPageInfo: null, pageLoaded: false,
};
function database() {
  return {
    execute: vi.fn<OnlineSyncSql['execute']>().mockResolvedValue({ affectedRows: 1 }),
    query: vi.fn<OnlineSyncSql['query']>().mockResolvedValue([{ attempts: 2, payload_json: null }]),
  };
}

describe('online sync business ownership', () => {
  it('claims only explicitly activated and unpaused businesses without creating activation state', async () => {
    const sql = database();
    expect(await claimOnlineSyncBusiness('business', sql)).toMatchObject({ businessId: 'business', token: expect.any(String) });
    expect(sql.execute.mock.calls[0][0]).toContain("rollout_state IN ('validation','cutover')");
    expect(sql.execute.mock.calls[0][0]).toContain('lease_expires_at <= UTC_TIMESTAMP(3)');
    expect(sql.execute.mock.calls[0][0]).not.toContain('INSERT');
    sql.execute.mockResolvedValue({ affectedRows: 0 });
    expect(await claimOnlineSyncBusiness('business', sql)).toBeNull();
  });
  it('cannot renew expired ownership, but safely releases only its own token', async () => {
    const sql = database();
    sql.execute.mockResolvedValue({ affectedRows: 0 });
    await expect(renewOnlineSyncBusiness(business, sql)).rejects.toThrow('no longer owned');
    await expect(releaseOnlineSyncBusiness(business, sql)).resolves.toBeUndefined();
    expect(sql.execute.mock.calls[1][1]).toEqual(['business', 'business-token']);
  });
});

describe('online sync durable job claims', () => {
  it('deduplicates enqueue without resetting a running checkpoint or accepting an unscoped owner', async () => {
    const sql = database();
    await enqueueOnlineSyncJob({
      businessId: 'business', channelInstanceId: 'store', provider: 'shopify',
      operation: 'shopify_order_reconcile', operationKey: 'reconcile',
    }, sql);
    expect(sql.execute.mock.calls[0][0]).toContain('INSERT IGNORE');
    expect(sql.execute.mock.calls[0][0]).not.toContain('ON DUPLICATE KEY UPDATE');
    await expect(enqueueOnlineSyncJob({
      businessId: '', channelInstanceId: 'store', provider: 'shopify',
      operation: 'shopify_order_reconcile', operationKey: 'reconcile',
    }, sql)).rejects.toThrow('exact online sync owner');
  });
  it('claims only the exact operation and requires a live business lease', async () => {
    const sql = database();
    const claimed = await claimOnlineSyncJob(job, sql);
    expect(claimed).toMatchObject({ attempts: 2, continuation: null, token: expect.any(String) });
    const [statement, parameters] = sql.execute.mock.calls[0];
    expect(statement).toContain("job.status IN ('pending','failed')");
    expect(statement).toContain("job.status = 'processing' AND job.lease_expires_at <= UTC_TIMESTAMP(3)");
    expect(statement).toContain('control.lease_token = ?');
    expect(parameters).toContain('business-token');
    expect(parameters).toContain('shopify_order_reconcile');
    expect(parameters).toContain('reconcile');
    expect(sql.query.mock.calls[0][0]).toContain('job.lease_token = ?');
    sql.execute.mockResolvedValue({ affectedRows: 0 });
    expect(await claimOnlineSyncJob(job, sql)).toBeNull();
  });
  it('detects lost ownership after a claim and rejects corrupt continuation instead of skipping it', async () => {
    const sql = database();
    sql.query.mockResolvedValue([]);
    await expect(claimOnlineSyncJob(job, sql)).rejects.toThrow('no longer owned');
    sql.query.mockResolvedValue([{ attempts: 2, payload_json: '{}' }]);
    await expect(claimOnlineSyncJob(job, sql)).rejects.toThrow('Missing reconciliation window');
  });
  it('renews business ownership before renewing the job, and never revives an expired job', async () => {
    const sql = database();
    await renewOnlineSyncJob(job, sql);
    expect(sql.execute.mock.calls[0][0]).toContain('UPDATE ims_online_sync_control');
    expect(sql.execute.mock.calls[1][0]).toContain('job.lease_expires_at > UTC_TIMESTAMP(3)');
    sql.execute.mockResolvedValue({ affectedRows: 0 });
    await expect(renewOnlineSyncJob(job, sql)).rejects.toThrow('no longer owned');
  });
});

describe('every checkpoint and result is fenced', () => {
  it.each([
    ['checkpoint', (sql: OnlineSyncSql) => checkpointOnlineSyncJob(job, continuation, sql)],
    ['finish', (sql: OnlineSyncSql) => finishOnlineSyncJob(job, null, sql)],
    ['yield', (sql: OnlineSyncSql) => yieldOnlineSyncJob(job, sql)],
    ['fail', (sql: OnlineSyncSql) => failOnlineSyncJob(job, 'provider_unavailable', 0, 0, sql)],
  ])('%s requires both unexpired tokens and exact tenant/channel/operation', async (_name, action) => {
    const sql = database();
    await action(sql);
    const [statement, parameters] = sql.execute.mock.calls[0];
    for (const fence of ['job.business_id = ?', 'job.channel_instance_id = ?', 'job.operation = ?',
      'job.operation_key = ?', 'job.lease_token = ?', 'control.lease_token = ?',
      'job.lease_expires_at > UTC_TIMESTAMP(3)', 'control.lease_expires_at > UTC_TIMESTAMP(3)']) {
      expect(statement).toContain(fence);
    }
    expect(parameters).toContain('job-token');
    expect(parameters).toContain('business-token');
    sql.execute.mockResolvedValue({ affectedRows: 0 });
    await expect(action(sql)).rejects.toThrow('no longer owned');
  });
  it('checks actual ownership before external side effects', async () => {
    const sql = database();
    await assertOnlineSyncLease(job, sql);
    sql.query.mockResolvedValue([]);
    await expect(assertOnlineSyncLease(job, sql)).rejects.toThrow('no longer owned');
  });
  it('keeps the saved payload on failure/yield and never drops work after the escalation threshold', async () => {
    const sql = database();
    await failOnlineSyncJob({ ...job, attempts: 99 }, 'provider_rate_limit', 0, 7200, sql);
    expect(sql.execute.mock.calls[0][1].slice(0, 2)).toEqual([7200, 'provider_rate_limit']);
    expect(sql.execute.mock.calls[0][0]).not.toContain('payload_json');
    await yieldOnlineSyncJob(job, sql);
    expect(sql.execute.mock.calls[1][0]).not.toContain('payload_json');
  });
  it('persists only a validated completed watermark under the same final fence', async () => {
    const sql = database();
    const payload = { kind: 'gift_cards' as const, continuation: null, coveredThrough: '2026-10-17T01:00:00Z' };
    await finishOnlineSyncJob(job, '2026-10-17T01:15:00Z', sql, payload);
    const [statement, parameters] = sql.execute.mock.calls[0];
    expect(statement).toContain('job.payload_json = ?');
    expect(statement).toContain('control.lease_token = ?');
    expect(parameters[2]).toBe(JSON.stringify(payload));
  });
});
