import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertConsignmentPosMutationAllowed, captureConsignmentRefund, captureConsignmentSale, captureSourceFact, sourceEventKey, validateSourceFact, type SourceFact } from '../sourceCapture';
import { getTrackingInterval } from '../tracking';

vi.mock('../tracking', () => ({ getTrackingInterval: vi.fn(), lockTrackingState: vi.fn() }));
vi.mock('../ownership', async importOriginal => ({
  ...await importOriginal<typeof import('../ownership')>(),
  resolveCurrentOwnership: vi.fn().mockResolvedValue({ ownership: 'consignment', supplierId: 2 }),
}));

const fact: SourceFact = {
  businessId: 'biz', supplierId: 2, sourceType: 'sale', sourceId: 3, sourceLineId: 4,
  eventKey: 'sale:3:4', variantId: 'uuid', locationId: 1, channel: 'pos',
  eventDate: '2026-10-16', quantity: 2, unitCost: 12.5, taxRate: 10,
};
describe('immutable consignment source facts', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getTrackingInterval).mockResolvedValue(null); });
  it('blocks POS refund voids that cannot atomically reverse linked credit-note stock and tenders', async () => {
    const execute = vi.fn().mockResolvedValue([[{ id: 1 }]]);
    await expect(assertConsignmentPosMutationAllowed({ execute } as any, 'biz', 3, 'void_refund')).rejects.toThrow(/linked credit note, stock and tender/);
  });
  it('does not block legacy owned POS mutation', async () => {
    const execute = vi.fn().mockResolvedValue([[]]);
    await expect(assertConsignmentPosMutationAllowed({ execute } as any, 'biz', 3, 'void_refund')).resolves.toBe(false);
  });
  it('captures reporting facts with tracking off and never assigns a statement', async () => {
    const execute = vi.fn().mockResolvedValue([{ insertId: 7 }]).mockResolvedValueOnce([[]]);
    await expect(captureSourceFact({ execute } as any, fact)).resolves.toBe(7);
    expect(getTrackingInterval).toHaveBeenCalledWith(expect.anything(), 'biz', '2026-10-16');
    expect(execute.mock.calls[1][0]).toContain('?,NULL,?');
    expect(execute.mock.calls[1][1]).toEqual(expect.arrayContaining([12.5, 10, null]));
  });
  it('uses actual movement cost and explicit received supplier tax instead of catalogue values', async () => {
    const execute = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_consignment_ownership_history')) return [[{ effective_at: '2026-01-01T00:00:00.000Z' }]];
      if (sql.includes('SELECT v.sku')) return [[{ sku: 'SKU', name: 'Product' }]];
      if (sql.includes('AS supplier_tax_rate')) return [[{ supplier_tax_rate: '0.1', tax_rates: 1, minimum_received_cost: 4 }]];
      if (sql.includes('SELECT unit_cost')) return [[{ unit_cost: '12.50' }]];
      if (sql.includes('SELECT * FROM ims_consignment_events')) return [[]];
      return [{ insertId: 8 }];
    });
    await captureConsignmentSale({ execute } as any, { ...fact, stockMovementId: 55, unitCost: 99 });
    const insert = execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO ims_consignment_events'))!;
    expect(insert[1].slice(13, 16)).toEqual([2, 12.5, 10]);
    expect(execute.mock.calls.some(([sql]) => sql.includes('avg_cost'))).toBe(false);
  });
  it('rejects missing supplier receipt tax rather than estimating GST', async () => {
    const execute = vi.fn().mockResolvedValueOnce([[{ effective_at: '2026-01-01T00:00:00.000Z' }]]).mockResolvedValueOnce([[{ sku: 'SKU' }]]).mockResolvedValueOnce([[{ tax_rates: 0, supplier_tax_rate: null }]]);
    await expect(captureConsignmentSale({ execute } as any, fact)).rejects.toThrow(/received supplier tax/);
  });
  it('rejects backdated imports before reliable ownership evidence', async () => {
    const execute = vi.fn().mockResolvedValue([[{ effective_at: '2027-01-01T00:00:00.000Z' }]]);
    await expect(captureConsignmentSale({ execute } as any, fact)).rejects.toThrow(/predates reliable/);
    expect(execute).toHaveBeenCalledOnce();
  });
  it('rejects fulfilment into negative supplier stock before recording dues', async () => {
    const execute = vi.fn().mockResolvedValueOnce([[{ effective_at: '2026-01-01T00:00:00.000Z' }]])
      .mockResolvedValueOnce([[{ sku: 'SKU', negative_stock: 1 }]]);
    await expect(captureConsignmentSale({ execute } as any, fact)).rejects.toThrow(/negative stock/);
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('keeps long source operation keys deterministic within the schema limit', () => {
    const key = 'shipment:'.repeat(100);
    expect(sourceEventKey(key)).toBe(sourceEventKey(key));
    expect(sourceEventKey(key)).not.toBe(sourceEventKey(`${key}2`));
    expect(sourceEventKey(key).length).toBeLessThanOrEqual(191);
  });
  it.each([{ quantity: 0 }, { quantity: -1 }, { unitCost: null }, { unitCost: -1 }, { taxRate: null }])('rejects unsupported source facts %j', change => {
    expect(() => validateSourceFact({ ...fact, ...change })).toThrow();
  });
  it('detects conflicting idempotent retries rather than overwriting costs', async () => {
    const execute = vi.fn().mockResolvedValue([[{ ...fact, supplier_id: 2, unit_cost: 99, variant_id: 'uuid' }]]);
    await expect(captureSourceFact({ execute } as any, fact)).rejects.toThrow(/immutable snapshot/);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('marks linked cross-cutover refunds for manual review', async () => {
    vi.mocked(getTrackingInterval).mockResolvedValue(5);
    const execute = vi.fn().mockResolvedValue([{ insertId: 7 }])
      .mockResolvedValueOnce([[{ tracking_interval_id: null }]]).mockResolvedValueOnce([[]]);
    await captureSourceFact({ execute } as any, { ...fact, sourceType: 'refund', quantity: -1, originalEventId: 1 });
    expect(execute.mock.calls[2][1]).toContain('Cross-cutover refund requires manual review');
  });
  it('allocates a no-restock refund using original shipment costs, not catalogue costs', async () => {
    const original = { id: 1, supplier_id: 2, quantity: 2, variant_id: 'uuid', channel: 'wholesale', unit_cost: 7, tax_rate: 10 };
    const execute = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("source_type = 'sale'")) return [[original]];
      if (sql.includes('SUM(quantity)')) return [[{ quantity: 0 }]];
      if (sql.includes('SELECT tracking_interval_id')) return [[{ tracking_interval_id: null }]];
      if (sql.includes('SELECT id, quantity') || sql.includes('SELECT * FROM ims_consignment_events WHERE business_id = ? AND event_key')) return [[]];
      return [{ insertId: 8 }];
    });
    await captureConsignmentRefund({ execute } as any, {
      businessId: 'biz', sourceId: 3, sourceLineId: 4, sourceChannel: 'sales_order',
      originalSourceId: 8, originalSourceLineId: 9, variantId: 'uuid', locationId: 1,
      eventDate: '2026-10-16', quantity: 1, eventKey: 'refund:3:4',
    });
    const insert = execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO ims_consignment_events'))!;
    expect(insert[1].slice(13, 16)).toEqual([-1, 7, 10]);
    expect(execute.mock.calls.some(([sql]) => sql.includes('avg_cost'))).toBe(false);
  });
});
