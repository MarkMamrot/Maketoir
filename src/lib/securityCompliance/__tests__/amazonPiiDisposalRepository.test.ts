import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import guards from '../../../../scripts/amazon-pii-guards.json';
import { approveAmazonPiiDisposal, getAmazonPiiDisposalPreview } from '../amazonPiiDisposalRepository';
import type { AmazonPiiDisposalRequest } from '../amazonPiiDisposal';

const mocks = vi.hoisted(() => ({ run: vi.fn(), execute: vi.fn(), query: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), pool: vi.fn() }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mocks.pool }));
const columns = [...readFileSync(path.join(process.cwd(), 'scripts', 'ims-schema.sql'), 'utf8')
  .matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\) ENGINE/g)]
  .flatMap(match => [...match[2].matchAll(/^\s+([a-z][a-z0-9_]*)\s/gm)]
    .map(column => ({ TABLE_NAME: match[1], COLUMN_NAME: column[1] })));
const now = new Date('2026-10-15T00:00:00.000Z');
let tenant: string | null;
let order: Record<string, unknown>, contact: Record<string, unknown>, groups: Record<string, Record<string, unknown>[]>;
let receipt: Record<string, unknown> | null, missing: boolean, shared: boolean, sharedLabel: boolean, parcelPending: boolean;
afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
  tenant = null; receipt = null; missing = false; shared = false; sharedLabel = false; parcelPending = false;
  order = { id: 42, business_id: 'tenant-a', customer_id: 9, status: 'fulfilled', sales_channel: 'amazon',
    channel_instance_id: 'instance-a', external_order_id: '111-2222222-3333333', earliest: '2026-09-15T00:00:00.000Z',
    delivery_address: 'Private Street', total_amount: '33.00', notes: 'Keep operational notes' };
  contact = { id: 9, business_id: 'tenant-a', name: 'Online Customer', type: 'retail_customer', store_credit: 0 };
  groups = {
    ims_shipping_shipments: [{ id: 7, business_id: 'tenant-a', so_id: 42, status: 'complete',
      recipient_json: { name: 'Jane', lines: ['Private Street'], phone: '123', email: 'jane@example.test' } }],
    ims_shipping_amendments: [], ims_shipping_labels: [],
    ims_shipping_channel_jobs: [], ims_sales_channel_events: [], ims_sales_channel_jobs: [],
  };
  mocks.run.mockImplementation(async (businessId: string, callback: () => Promise<unknown>) => {
    tenant = businessId;
    try { return await callback(); } finally { tenant = null; }
  });
  mocks.pool.mockImplementation(() => {
    expect(tenant).toBe('tenant-a');
    return { getConnection: async () => ({ execute: mocks.execute, query: mocks.query,
      beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release }) };
  });
  mocks.execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    sql = sql.replace('SELECT /*+ MAX_EXECUTION_TIME(10000) */ ', 'SELECT ');
    expect(tenant).toBe('tenant-a');
    if (sql.includes('information_schema.COLUMNS')) {
      if (sql.includes("COLUMN_NAME IN ('customer_id'")) return [[{ TABLE_NAME: 'pos_sales', COLUMN_NAME: 'customer_id' }]];
      return [missing ? [] : columns];
    }
    if (sql.includes('information_schema.TRIGGERS')) return [guards.map(guard => ({ TRIGGER_NAME: guard.name, ACTION_STATEMENT: guard.body }))];
    if (sql.includes('information_schema.STATISTICS')) return [[
      'uq_amazon_pii_order', 'uq_amazon_pii_external', 'uq_amazon_pii_operation', 'idx_amazon_pii_contact',
    ].map(INDEX_NAME => ({ INDEX_NAME }))];
    if (sql.includes('SELECT o.*')) return [[order]];
    if (sql.startsWith('SELECT * FROM ims_amazon_pii_disposals')) return [receipt ? [receipt] : []];
    if (sql.startsWith('SELECT * FROM ims_contacts')) return [[contact]];
    if (sql.startsWith('SELECT l.id')) return [sharedLabel ? [{ id: 1 }] : []];
    if (sql.startsWith('SELECT p.id')) return [parcelPending ? [{ id: 1 }] : []];
    if (sql.includes('FROM `pos_sales`')) return [shared ? [{ customer_id: 9 }] : []];
    const group = sql.match(/^SELECT \* FROM `(\w+)`/);
    if (group) {
      expect(params).toContain('tenant-a');
      return [groups[group[1]]];
    }
    const update = sql.match(/^UPDATE `(\w+)`/);
    if (update) {
      expect(params[params.length - 2]).toBe('tenant-a');
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('INSERT INTO ims_amazon_pii_disposals')) {
      receipt = { id: 1, business_id: params[0], so_id: params[1], operation_key: params[8], request_hash: params[9] };
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected fixture SQL: ${sql}`);
  });
});

async function approval(): Promise<AmazonPiiDisposalRequest> {
  const report = await getAmazonPiiDisposalPreview({ businessId: 'tenant-a', salesOrderId: 42, actorUserId: 99, now });
  return { expectedBusinessId: 'tenant-a', salesOrderId: 42, token: report.token, expiresAt: report.expiresAt,
    operationKey: '12345678-1234-4234-9234-123456789abc', confirmation: 'CLEAR AMAZON PII 42' };
}
async function approve(request: AmazonPiiDisposalRequest) {
  return approveAmazonPiiDisposal({ businessId: 'tenant-a', actorUserId: 99, request, now });
}

describe('tenant-safe approved identifying-field cleanup', () => {
  it('previews counts at exactly 30 days without writes, buyer data or carrier calls', async () => {
    const report = await getAmazonPiiDisposalPreview({ businessId: 'tenant-a', salesOrderId: 42, actorUserId: 99, now });
    expect(report.deadlineAt).toBe(now.toISOString());
    expect(report.blockers).toEqual([]);
    expect(report.fieldsToClear).toContainEqual({ source: 'Shipment recipients', fields: 4, records: 1 });
    expect(JSON.stringify(report)).not.toMatch(/Jane|Private Street|jane@example/);
    expect(mocks.query).toHaveBeenCalledWith('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    expect(mocks.execute.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
  });
  it.each([
    '2026-10-14T00:00:00.000Z',
    '2026-09-15T00:00:00.001Z',
    '2026-09-15T00:00:00.000Z',
    '2026-09-14T23:59:59.999Z',
  ])('allows approved cleanup before, at and after the maximum retention deadline (delivery %s)', async deliveredAt => {
    order.earliest = deliveredAt;
    const report = await getAmazonPiiDisposalPreview({ businessId: 'tenant-a', salesOrderId: 42, actorUserId: 99, now });
    expect(report.blockers).toEqual([]);
    expect(Date.parse(report.deadlineAt!)).toBe(Date.parse(deliveredAt) + 30 * 24 * 60 * 60 * 1000);
    expect(await approve(await approval())).toMatchObject({ structuredFieldsCleared: true });
    expect(mocks.commit).toHaveBeenCalled();
  });
  it('locks and clears only approved fields while preserving shared generic contacts and financial ownership', async () => {
    const request = await approval();
    expect(await approve(request)).toMatchObject({ structuredFieldsCleared: true, copyReviewRequired: true });
    const writes = mocks.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE'));
    expect(writes).toHaveLength(2);
    expect(writes.some(([sql]) => sql.includes('ims_contacts'))).toBe(false);
    expect(writes[0][0]).not.toMatch(/total_amount|customer_id|notes|stock|store_credit/);
    expect(mocks.execute.mock.calls.some(([sql]) => sql.includes('FOR UPDATE'))).toBe(true);
    const audit = mocks.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO ims_amazon_pii_disposals'))!;
    expect(audit[1][7]).toBe(99);
    expect(audit[1][4]).toBe(9);
    expect(JSON.stringify(audit[1])).not.toMatch(/Jane|Private Street|jane@example/);
    expect(await approve(request)).toMatchObject({ alreadyCleared: true });
    expect(mocks.execute.mock.calls.filter(([sql]) => sql.startsWith('INSERT'))).toHaveLength(1);
  });
  it('clears an exclusive identifying contact without writing credit balances', async () => {
    contact.name = 'Jane'; contact.email = 'jane@example.test';
    const request = await approval();
    await approve(request);
    const update = mocks.execute.mock.calls.find(([sql]) => sql.startsWith('UPDATE `ims_contacts`'))!;
    expect(update[0]).not.toMatch(/store_credit|on_account_limit/);
    expect(update[1][0]).toBe('Amazon Customer');
    expect(mocks.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO ims_amazon_pii_disposals'))![1][4]).toBe(9);
  });
  it.each(['shared-customer', 'shared-label', 'pending-parcel', 'active-job', 'missing-delivery', 'future-delivery', 'open-order'])('blocks unsafe cleanup (%s)', async condition => {
    if (condition === 'shared-customer') { contact.name = 'Jane'; shared = true; }
    if (condition === 'shared-label') sharedLabel = true;
    if (condition === 'pending-parcel') parcelPending = true;
    if (condition === 'active-job') groups.ims_sales_channel_jobs = [{ id: 8, status: 'failed', payload_json: {} }];
    if (condition === 'missing-delivery') order.earliest = null;
    if (condition === 'future-delivery') order.earliest = '2026-10-15T00:00:00.001Z';
    if (condition === 'open-order') order.status = 'partially_fulfilled';
    const request = await approval();
    await expect(approve(request)).rejects.toThrow();
    expect(mocks.execute.mock.calls.some(([sql]) => /^(UPDATE|INSERT|DELETE)/.test(sql))).toBe(false);
  });
  it('rejects changed records, expired previews, another business and idempotency-key reuse', async () => {
    const request = await approval();
    order.delivery_address = 'Changed';
    await expect(approve(request)).rejects.toThrow('changed');
    await expect(approve({ ...request, expectedBusinessId: 'tenant-b' })).rejects.toThrow('active business');
    await expect(approve({ ...request, expiresAt: now.toISOString() })).rejects.toThrow('expired');
    const fresh = await approval();
    await approve(fresh);
    await expect(approve({ ...fresh, operationKey: '22345678-1234-4234-9234-123456789abc' })).rejects.toThrow('different cleanup');
  });
  it('refuses incomplete schema before destructive work and never runs lazy DDL', async () => {
    missing = true;
    await expect(approval()).rejects.toThrow('not ready');
    expect(mocks.execute.mock.calls.some(([sql]) => /^(CREATE|ALTER|UPDATE|INSERT)/.test(sql))).toBe(false);
  });
  it('rolls back the whole operation when an identifying-field update fails', async () => {
    const request = await approval();
    const original = mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('UPDATE')) throw new Error('Write failed');
      return original(sql, params);
    });
    await expect(approve(request)).rejects.toThrow('Write failed');
    expect(mocks.rollback).toHaveBeenCalled();
    expect(receipt).toBeNull();
  });
});
