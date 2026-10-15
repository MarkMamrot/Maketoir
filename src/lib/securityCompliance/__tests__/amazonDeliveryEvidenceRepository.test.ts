import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELIVERY_EVIDENCE_COLUMNS, getAmazonDeliveryEvidence, saveCarrierDeliveryEvidence, saveManualDeliveryEvidence } from '../amazonDeliveryEvidenceRepository';
import { validateManualDeliveryRequest } from '../amazonDeliveryEvidence';

const mocks = vi.hoisted(() => ({
  run: vi.fn(), execute: vi.fn(), query: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), pool: vi.fn(),
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mocks.pool }));
const operationKey = '12345678-1234-4234-9234-123456789abc';
function manual() {
  const input = validateManualDeliveryRequest({
    action: 'record', salesOrderId: 42, parcelId: null, deliveredAt: '2025-09-01T10:00:00+10:00',
    basis: 'carrier-portal', reference: 'TICKET-123', operationKey, verified: true,
  });
  if (input.action !== 'record') throw new Error('Invalid manual evidence fixture.');
  return input;
}
let tenant: string | null;
let existing: Map<string, { id: number; request_hash: string }>;
let foundOrder: boolean, foundParcel: boolean, duplicateArticle: boolean, missingStorage: boolean, activeTarget: boolean;
let orderChannel: string;

beforeEach(() => {
  vi.clearAllMocks();
  tenant = null; existing = new Map(); foundOrder = true; foundParcel = true; duplicateArticle = false; missingStorage = false; activeTarget = true; orderChannel = 'amazon';
  mocks.run.mockImplementation(async (businessId: string, callback: () => Promise<unknown>) => {
    tenant = businessId;
    try { return await callback(); } finally { tenant = null; }
  });
  mocks.pool.mockImplementation(() => {
    expect(tenant).toBe('tenant-a');
    return { getConnection: async () => ({ execute: mocks.execute, query: mocks.query,
      beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release }) };
  });
  mocks.execute.mockImplementation(async (sql: string, params: unknown[]) => {
    expect(tenant).toBe('tenant-a');
    if (sql.includes('information_schema.COLUMNS')) return [missingStorage ? [] : DELIVERY_EVIDENCE_COLUMNS.map(COLUMN_NAME => ({ COLUMN_NAME }))];
    expect(params).toContain('tenant-a');
    if (sql.includes('FROM ims_sales_orders')) {
      const allowed = sql.includes("o.sales_channel = 'amazon'") ? orderChannel === 'amazon' : params.slice(2).includes(orderChannel);
      return [foundOrder && allowed ? [{ id: 42, orderDate: '2025-09-01', earliest: null }] : []];
    }
    if (sql.includes('SELECT id, request_hash')) return [existing.has(String(params[1])) ? [existing.get(String(params[1]))] : []];
    if (sql.includes('BINARY p.article_id')) return [duplicateArticle ? [{ id: 9 }, { id: 10 }] : [{ id: 9 }]];
    if (sql.includes('SELECT p.id')) return [foundParcel ? [{ id: 9, article_id: 'ARTICLE1', provider: 'auspost_eparcel',
      shipment_id: 8, parcel_number: 1, lastCheckedAt: null, outcome: null }] : []];
    if (sql.includes("d.source = 'manual'")) return [[{ id: 7, parcel_id: 9, active: activeTarget ? 1 : 0 }]];
    if (sql.includes('FROM ims_amazon_delivery_evidence d')) return [[]];
    if (sql.startsWith('INSERT INTO ims_amazon_delivery_evidence')) {
      existing.set(String(params[10]), { id: 7, request_hash: String(params[11]) });
      return [{ insertId: 7 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
});

describe('tenant-scoped immutable delivery evidence', () => {
  it('reads safe delivery metadata in a consistent read-only snapshot', async () => {
    const result = await getAmazonDeliveryEvidence('tenant-a', 42);
    expect(result).toMatchObject({ salesOrderId: 42, earliestVerifiedDeliveryAt: null, history: [] });
    expect(result.parcels[0]).toMatchObject({ id: 9, automaticTracking: true });
    expect(JSON.stringify(result)).not.toContain('ARTICLE1');
    expect(mocks.query).toHaveBeenCalledWith('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    expect(mocks.execute.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('records the verified actor and UTC delivery while retrying idempotently', async () => {
    expect(await saveManualDeliveryEvidence('tenant-a', 99, manual())).toBe(7);
    expect(await saveManualDeliveryEvidence('tenant-a', 99, manual())).toBe(7);
    const inserts = mocks.execute.mock.calls.filter(([sql]) => sql.startsWith('INSERT'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toEqual(['tenant-a', 42, null, 'delivery', 'manual', '2025-09-01 00:00:00.000',
      'carrier-portal', 'TICKET-123', 99, null, `manual:${operationKey}`, expect.stringMatching(/^[a-f0-9]{64}$/)]);
    expect(mocks.execute.mock.calls.some(([sql]) => /^(UPDATE|DELETE|CREATE|ALTER)/.test(sql))).toBe(false);
  });
  it('rejects reusing a verification key with a different actor or date', async () => {
    await saveManualDeliveryEvidence('tenant-a', 99, manual());
    await expect(saveManualDeliveryEvidence('tenant-a', 100, manual())).rejects.toThrow('different evidence');
    await expect(saveManualDeliveryEvidence('tenant-a', 99, { ...manual(), deliveredAt: '2025-09-02T00:00:00.000Z' })).rejects.toThrow();
  });
  it('rechecks dispatched original parcel ownership and keeps only a tracking fingerprint', async () => {
    await saveCarrierDeliveryEvidence({ businessId: 'tenant-a', salesOrderId: 42, parcelId: 9, articleId: 'ARTICLE1', deliveredAt: '2025-09-01T00:00:00Z' });
    const insert = mocks.execute.mock.calls.find(([sql]) => sql.startsWith('INSERT'))!;
    expect(insert[1][7]).toMatch(/^auspost-article:[a-f0-9]{64}$/);
    expect(insert[1][8]).toBeNull();
    expect(JSON.stringify(insert[1])).not.toContain('ARTICLE1');
    const ownership = mocks.execute.mock.calls.find(([sql]) => sql.includes('s.so_id = ?'))!;
    expect(ownership[1]).toEqual(['tenant-a', 9, 42]);
    expect(ownership[0]).toContain('s.ims_fulfilled_at IS NOT NULL');
    expect(ownership[0]).toContain('s.voided_at IS NULL');
  });
  it.each(['missing', 'wrong-article', 'duplicate-article'])('rejects unsafe carrier association (%s)', async mode => {
    foundParcel = mode !== 'missing'; duplicateArticle = mode === 'duplicate-article';
    await expect(saveCarrierDeliveryEvidence({ businessId: 'tenant-a', salesOrderId: 42, parcelId: 9,
      articleId: mode === 'wrong-article' ? 'OTHER' : 'ARTICLE1', deliveredAt: '2025-09-01T00:00:00Z' })).rejects.toThrow();
    expect(mocks.execute.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });
  it('adds an actor-attributed correction without overwriting evidence, and retries it safely', async () => {
    const correction = validateManualDeliveryRequest({ action: 'void', salesOrderId: 42, evidenceId: 7, reason: 'wrong-date', operationKey });
    await saveManualDeliveryEvidence('tenant-a', 99, correction);
    activeTarget = false;
    await saveManualDeliveryEvidence('tenant-a', 99, correction);
    const inserts = mocks.execute.mock.calls.filter(([sql]) => sql.startsWith('INSERT'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1].slice(0, 10)).toEqual(['tenant-a', 42, 9, 'void', 'manual', null, 'wrong-date', 'RECORD-7', 99, 7]);
    expect(mocks.execute.mock.calls.some(([sql]) => /^(DELETE|UPDATE)/.test(sql))).toBe(false);
  });
  it('blocks cross-business or non-Amazon orders and missing schema without lazy DDL', async () => {
    foundOrder = false;
    await expect(saveManualDeliveryEvidence('tenant-a', 99, manual())).rejects.toThrow('active business');
    missingStorage = true;
    await expect(getAmazonDeliveryEvidence('tenant-a', 42)).rejects.toThrow('storage is not ready');
    expect(mocks.execute.mock.calls.some(([sql]) => /^(CREATE|ALTER|INSERT)/.test(sql))).toBe(false);
  });
  it.each(['shopify', 'native_shop'])('stores %s carrier evidence without exposing Amazon review or manual workflows', async provider => {
    orderChannel = provider;
    expect(await saveCarrierDeliveryEvidence({
      businessId: 'tenant-a', salesOrderId: 42, parcelId: 9, articleId: 'ARTICLE1', deliveredAt: '2025-09-01T00:00:00Z',
    })).toBe(7);
    await expect(getAmazonDeliveryEvidence('tenant-a', 42)).rejects.toThrow('Amazon order not found');
    await expect(saveManualDeliveryEvidence('tenant-a', 99, manual())).rejects.toThrow('Amazon order not found');
    expect(mocks.execute.mock.calls.filter(([sql]) => sql.startsWith('INSERT'))).toHaveLength(1);
    expect(mocks.execute.mock.calls.some(([sql]) => /^(UPDATE|DELETE)/.test(sql))).toBe(false);
  });
  it('rejects carrier evidence for an order outside supported online channel types', async () => {
    orderChannel = 'retail';
    await expect(saveCarrierDeliveryEvidence({
      businessId: 'tenant-a', salesOrderId: 42, parcelId: 9, articleId: 'ARTICLE1', deliveredAt: '2025-09-01T00:00:00Z',
    })).rejects.toThrow('Online-channel order not found');
    expect(mocks.execute.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });
});
