import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: mocks.pool, imsQuery: mocks.query, imsExecute: mocks.execute,
}));

import {
  claimShopifyOrderSnapshot, completeShopifyOrderSnapshot, releaseShopifyOrderLease,
  renewShopifyOrderLease, runShopifyOrderEffect,
} from '../shopifyOrderCoordination';

const snapshot = { businessId: 'alpha', channelInstanceId: 'store', externalOrderId: '123',
  updatedAt: '2026-10-17T01:00:00.000Z', hash: 'a'.repeat(64) };
const lease = { ...snapshot, token: 'token' };
const state = (completed = false) => ({
  version: 1, snapshot: { updatedAt: snapshot.updatedAt, hash: snapshot.hash },
  required: ['order_record'], completed, effects: completed ? { order_record: { status: 'applied' } } : {},
});
const row = (effects: ReturnType<typeof state> | null = null) => ({
  effects_json: effects, review_reason: null,
  provider_updated_at: effects?.completed ? snapshot.updatedAt : null,
  applied_hash: effects?.completed ? snapshot.hash : null,
});

describe('Shopify order lease and source-version policy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.query.mockResolvedValue([row()]);
  });
  it('persists a bounded effect plan and retains exactly the new order token', async () => {
    const claimed = await claimShopifyOrderSnapshot(snapshot, ['order_record']);
    expect(claimed).toMatchObject({ status: 'ready', lease: { ...snapshot, token: expect.any(String) } });
    expect(mocks.execute).toHaveBeenCalledTimes(3);
    const persisted = JSON.parse(mocks.execute.mock.calls[2][1][0]);
    expect(persisted).toEqual(state());
    expect(mocks.execute.mock.calls[1][1].slice(-3)).toEqual(['alpha', 'store', '123']);
    expect(mocks.execute.mock.calls[1][0]).toContain('UTC_TIMESTAMP(3)');
  });
  it('returns busy without reading or writing effects after losing a claim', async () => {
    mocks.execute.mockResolvedValueOnce({ affectedRows: 1 }).mockResolvedValueOnce({ affectedRows: 0 });
    await expect(claimShopifyOrderSnapshot(snapshot, ['order_record'])).resolves.toEqual({ status: 'busy' });
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('resumes the exact unfinished snapshot without discarding its effect receipts', async () => {
    mocks.query.mockResolvedValue([row(state())]);
    await expect(claimShopifyOrderSnapshot(snapshot, ['order_record'])).resolves.toMatchObject({ status: 'ready' });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it.each([
    { updatedAt: '2026-10-17T00:59:59Z', status: 'stale' },
    { updatedAt: snapshot.updatedAt, status: 'duplicate' },
  ])('releases ownership on a $status snapshot', async ({ updatedAt, status }) => {
    mocks.query.mockResolvedValue([row(state(true))]);
    await expect(claimShopifyOrderSnapshot({ ...snapshot, updatedAt }, ['order_record']))
      .resolves.toEqual({ status });
    expect(mocks.execute.mock.calls.at(-1)?.[0]).toContain('SET lease_token = NULL');
    expect(mocks.execute.mock.calls.at(-1)?.[1].slice(0, 3)).toEqual(['alpha', 'store', '123']);
  });
  it.each([
    { changes: { hash: 'b'.repeat(64) }, required: ['order_record'], reason: 'provider_version_conflict' },
    { changes: {}, required: ['order_details'], reason: 'effect_plan_changed' },
    { changes: { updatedAt: '2026-10-17T01:01:00Z', hash: 'b'.repeat(64) }, required: ['order_record'], reason: 'unfinished_snapshot_changed' },
  ])('persists review instead of guessing through $reason', async ({ changes, required, reason }) => {
    mocks.query.mockResolvedValue([row({
      ...state(), required: ['loyalty', 'order_record'], effects: { order_record: { status: 'applied' } },
    })]);
    await expect(claimShopifyOrderSnapshot({ ...snapshot, ...changes }, required))
      .resolves.toEqual({ status: 'review', reason });
    expect(mocks.execute.mock.calls[2][0]).toContain('SET recovery.review_reason = ?');
    expect(mocks.execute.mock.calls[2][1][0]).toBe(reason);
    expect(mocks.execute.mock.calls.at(-1)?.[0]).toContain('SET lease_token = NULL');
  });
  it('can replace an interrupted discovery with newer data when no local effect committed', async () => {
    mocks.query.mockResolvedValue([row(state())]);
    await expect(claimShopifyOrderSnapshot({
      ...snapshot, updatedAt: '2026-10-17T01:01:00Z', hash: 'b'.repeat(64),
    }, ['order_record'])).resolves.toMatchObject({ status: 'ready' });
    const persisted = JSON.parse(mocks.execute.mock.calls[2][1][0]);
    expect(persisted.effects).toEqual({});
    expect(persisted.snapshot.hash).toBe('b'.repeat(64));
  });
  it('resumes existing receipts when only the provider version changed, not functional inputs', async () => {
    mocks.query.mockResolvedValue([row({
      ...state(), required: ['loyalty', 'order_record'], effects: { order_record: { status: 'applied' } },
    })]);
    await expect(claimShopifyOrderSnapshot({
      ...snapshot, updatedAt: '2026-10-17T01:01:00Z',
    }, ['loyalty', 'order_record'])).resolves.toMatchObject({ status: 'ready' });
    const persisted = JSON.parse(mocks.execute.mock.calls[2][1][0]);
    expect(persisted.effects.order_record).toEqual({ status: 'applied' });
    expect(persisted.snapshot.updatedAt).toBe('2026-10-17T01:01:00Z');
  });
  it('does not allow an applied-version timestamp to disagree with its completed receipt', async () => {
    mocks.query.mockResolvedValue([{ ...row(state(true)), provider_updated_at: '2026-10-17 01:01:00.000' }]);
    await expect(claimShopifyOrderSnapshot(snapshot, ['order_record'])).rejects.toThrow('Inconsistent applied');
  });
  it('does not clear an existing review through a new or repeated source snapshot', async () => {
    mocks.query.mockResolvedValue([{ ...row(), review_reason: 'provider_version_conflict' }]);
    await expect(claimShopifyOrderSnapshot(snapshot, ['order_record']))
      .resolves.toEqual({ status: 'review', reason: 'provider_version_conflict' });
    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });
  it.each([[], ['order_record', 'order_record'], ['invalid.key'], ['x'.repeat(51)]])(
    'rejects an invalid effect plan (%j) before any SQL', async (...keys: string[]) => {
      await expect(claimShopifyOrderSnapshot(snapshot, keys)).rejects.toThrow();
      expect(mocks.execute).not.toHaveBeenCalled();
    },
  );
  it('fails on corrupted state instead of overwriting it with a success-shaped baseline', async () => {
    mocks.query.mockResolvedValue([{ ...row(), effects_json: '{broken' }]);
    await expect(claimShopifyOrderSnapshot(snapshot, ['order_record'])).rejects.toThrow();
    expect(mocks.execute.mock.calls.at(-1)?.[0]).toContain('SET lease_token = NULL');
  });
  it('accepts the 1000-effect bound and rejects 1001 before issuing SQL', async () => {
    const required = Array.from({ length: 1000 }, (_, index) => `refund:${index + 1}`);
    await expect(claimShopifyOrderSnapshot(snapshot, required)).resolves.toMatchObject({ status: 'ready' });
    mocks.execute.mockClear();
    await expect(claimShopifyOrderSnapshot(snapshot, [...required, 'refund:1001'])).rejects.toThrow('bounded, unique');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('rejects inconsistent applied metadata', async () => {
    mocks.query.mockResolvedValue([{ ...row(), provider_updated_at: snapshot.updatedAt, applied_hash: snapshot.hash }]);
    await expect(claimShopifyOrderSnapshot(snapshot, ['order_record'])).rejects.toThrow('Inconsistent applied');
  });
  it('does not turn a fenced checkpoint failure into a ready claim', async () => {
    mocks.execute.mockResolvedValueOnce({ affectedRows: 1 }).mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 0 }).mockResolvedValue({ affectedRows: 1 });
    await expect(claimShopifyOrderSnapshot(snapshot, ['order_record'])).rejects.toThrow('no longer owned');
  });
  it('requires unexpired ownership for renewal and never releases another token', async () => {
    mocks.execute.mockResolvedValue({ affectedRows: 0 });
    await expect(renewShopifyOrderLease(lease)).rejects.toThrow('no longer owned');
    await releaseShopifyOrderLease(lease);
    expect(mocks.execute.mock.calls[0][0]).toContain('lease_expires_at > UTC_TIMESTAMP(3)');
    expect(mocks.execute.mock.calls[1][1]).toEqual(['alpha', 'store', '123', 'token']);
  });
});

describe('transactional Shopify effect receipts', () => {
  const connection = {
    execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  };
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.pool.mockReturnValue({ getConnection: async () => connection });
    connection.execute.mockImplementation(async (sql: string) => sql.startsWith('SELECT')
      ? [[{ effects_json: state() }]] : [{ affectedRows: 1 }]);
  });
  it('commits a domain write and receipt in the same transaction and releases the connection', async () => {
    const apply = vi.fn().mockResolvedValue({ status: 'applied', referenceId: '44' });
    await expect(runShopifyOrderEffect(lease, 'order_record', apply)).resolves.toEqual({
      duplicate: false, result: { status: 'applied', referenceId: '44' },
    });
    expect(apply).toHaveBeenCalledWith(connection);
    expect(connection.execute.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(connection.execute.mock.calls[1][0]).toContain('lease_expires_at > UTC_TIMESTAMP(3)');
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
  it('does not reapply a locally completed effect', async () => {
    connection.execute.mockResolvedValue([[{ effects_json: {
      ...state(), effects: { order_record: { status: 'applied', referenceId: '44' } },
    } }]]);
    const apply = vi.fn();
    await expect(runShopifyOrderEffect(lease, 'order_record', apply))
      .resolves.toMatchObject({ duplicate: true, result: { referenceId: '44' } });
    expect(apply).not.toHaveBeenCalled();
  });
  it('rejects expired or superseded ownership before invoking the domain callback', async () => {
    connection.execute.mockResolvedValue([[]]);
    const apply = vi.fn();
    await expect(runShopifyOrderEffect(lease, 'order_record', apply)).rejects.toThrow('no longer owned');
    expect(apply).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
  it('rolls back domain writes if the receipt loses its fence', async () => {
    connection.execute.mockResolvedValueOnce([[{ effects_json: state() }]])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);
    await expect(runShopifyOrderEffect(lease, 'order_record', async () => ({ status: 'applied' })))
      .rejects.toThrow('no longer owned');
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
  it('does not accept a claimed handoff without a durable exact-owner job', async () => {
    connection.execute.mockResolvedValueOnce([[{ effects_json: state() }]]).mockResolvedValueOnce([[]]);
    await expect(runShopifyOrderEffect(lease, 'order_record', async () => ({
      status: 'queued', operation: 'shopify_order_apply', operationKey: 'refund:81',
    }))).rejects.toThrow('not durably queued');
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
  it('does not allow completion with a missing effect or handoff', async () => {
    await expect(completeShopifyOrderSnapshot(lease)).rejects.toThrow('unfinished local effects');
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
  it('does not interpret inherited JavaScript properties as effect receipts', async () => {
    connection.execute.mockResolvedValue([[{ effects_json: { ...state(), required: ['constructor'] } }]]);
    await expect(completeShopifyOrderSnapshot(lease)).rejects.toThrow('unfinished local effects');
    expect(connection.commit).not.toHaveBeenCalled();
  });
});
