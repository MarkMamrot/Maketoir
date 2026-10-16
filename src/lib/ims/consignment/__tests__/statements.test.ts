import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';
import type { ConsignmentEvent } from '../domain';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), tracking: vi.fn() }));
vi.mock('../db', () => ({ query: mocks.query, execute: mocks.execute }));
vi.mock('../tracking', () => ({ requireTracking: mocks.tracking }));
import { createStatement, mutateStatement } from '../statements';
import { eventFingerprint } from '../domain';

const db = {} as PoolConnection;
const source: ConsignmentEvent = {
  id: 3, business_id: 'tenant-a', supplier_id: 5, source_type: 'sale', source_id: 'SO-1', source_line_id: '1',
  event_key: 'sale:1', original_event_id: null, variant_id: 'v1', sku: 'SKU', product_name: 'Product', location_id: 1,
  channel: 'pos', event_date: '2026-10-16', quantity: 2, unit_cost: 5, tax_rate: 10,
  tracking_interval_id: 7, statement_id: null, exception: null,
};
let statement: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  statement = {
    id: 9, business_id: 'tenant-a', supplier_id: 5, tracking_interval_id: 7, number: 'CS-9', status: 'Draft', version: 1,
    period_from: '2026-10-16', period_to: '2026-10-16', include_carry_forward: 0,
    snapshot_json: { events: [source], fingerprint: eventFingerprint([source]), supplier: { id: 5, name: 'Supplier' }, business: { name: 'Business' } },
  };
  mocks.tracking.mockResolvedValue({ interval: { id: 7, cutover_date: '2026-10-01' } });
  mocks.execute.mockResolvedValue({ insertId: 9, affectedRows: 1 });
  mocks.query.mockImplementation(async (_db, sql: string) => {
    if (sql.includes('FROM ims_consignment_statements')) return [statement];
    if (sql.includes('FROM ims_consignment_events')) return [source];
    if (sql.includes('FROM ims_contacts')) return [{ id: 5, name: 'Supplier' }];
    return [];
  });
});
describe('statement lifecycle transaction boundaries', () => {
  it('creates overlapping drafts without reserving source facts', async () => {
    await createStatement(db, 'tenant-a', 1, 'Business', { supplierId: 5, from: '2026-10-16', to: '2026-10-16' });
    expect(mocks.execute.mock.calls.some(call => /UPDATE ims_consignment_events SET statement_id/.test(call[1]))).toBe(false);
    expect(mocks.tracking).toHaveBeenCalledWith(db, 'tenant-a');
  });
  it('rejects a stale preview before claiming anything', async () => {
    statement.snapshot_json = { ...(statement.snapshot_json as object), fingerprint: 'outdated' };
    await expect(mutateStatement(db, 'tenant-a', 1, 9, { action: 'finalise', version: 1 })).rejects.toThrow('stale');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('atomically claims a reviewed preview and increments version', async () => {
    await mutateStatement(db, 'tenant-a', 1, 9, { action: 'finalise', version: 1 });
    expect(mocks.execute.mock.calls.some(call => call[1].includes('statement_id IS NULL') && call[2][0] === 9)).toBe(true);
    expect(mocks.execute.mock.calls.some(call => call[1].includes('version=version+1') && call[2][0] === 'Finalised')).toBe(true);
  });
  it('blocks finalisation of missing evidence even when the fingerprint matches', async () => {
    const missing = { ...source, unit_cost: null };
    statement.snapshot_json = { ...(statement.snapshot_json as object), events: [missing], fingerprint: eventFingerprint([missing]) };
    mocks.query.mockImplementation(async (_db, sql: string) => sql.includes('FROM ims_consignment_statements') ? [statement] : sql.includes('FROM ims_consignment_events') ? [missing] : []);
    await expect(mutateStatement(db, 'tenant-a', 1, 9, { action: 'finalise', version: 1 })).rejects.toThrow('Resolve missing');
  });
  it('rejects stale versions and disabled tracking before any mutation', async () => {
    await expect(mutateStatement(db, 'tenant-a', 1, 9, { action: 'finalise', version: 2 })).rejects.toThrow('changed');
    mocks.tracking.mockRejectedValue(new Error('tracking off'));
    await expect(mutateStatement(db, 'tenant-a', 1, 9, { action: 'finalise', version: 1 })).rejects.toThrow('tracking off');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('cancellation releases claims but retains the snapshot and audit', async () => {
    statement.status = 'Finalised';
    await mutateStatement(db, 'tenant-a', 1, 9, { action: 'cancel', version: 1, reason: 'Supplier review' });
    expect(mocks.execute.mock.calls.some(call => call[1].includes('SET statement_id=NULL'))).toBe(true);
    expect(mocks.execute.mock.calls.some(call => call[1].includes('snapshot_json='))).toBe(false);
    expect(mocks.execute.mock.calls.filter(call => call[1].includes('statement_audit')).length).toBe(2);
  });
  it('cannot cancel Accounted or account without reference and date', async () => {
    statement.status = 'Accounted';
    await expect(mutateStatement(db, 'tenant-a', 1, 9, { action: 'cancel', version: 1, reason: 'No' })).rejects.toThrow('Cannot cancel');
    statement.status = 'Finalised';
    await expect(mutateStatement(db, 'tenant-a', 1, 9, { action: 'account', version: 1 })).rejects.toThrow('Accounting reference');
  });
  it('all statement and source reads are explicitly scoped to the tenant', async () => {
    await mutateStatement(db, 'tenant-a', 1, 9, { action: 'refresh', version: 1 });
    for (const [, sql, args] of mocks.query.mock.calls) {
      expect(sql).toContain('business_id=?'); expect(args).toContain('tenant-a');
    }
  });
});
