import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpeningStockSnapshot, OpeningStockSnapshotLine } from '../shopifyOpeningStockSnapshot';

const mocks = vi.hoisted(() => ({
  pool: vi.fn(), query: vi.fn(), claim: vi.fn(), complete: vi.fn(), apply: vi.fn(),
}));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mocks.pool, imsQuery: mocks.query }));
vi.mock('../inventoryDocumentOperations', () => ({
  claimInventoryDocumentOperation: mocks.claim, completeInventoryDocumentOperation: mocks.complete,
}));
vi.mock('../stocktakes/stocktakeOperations', () => ({ applyStocktakeInTransaction: mocks.apply }));

import { applyOpeningStockBatch, openingStocktakeReference, prepareOpeningStocktakes } from '../shopifyOpeningStockApply';

const context = { businessId: 'biz-1', channelInstanceId: 'store-1', runId: 'run-12345678', actorId: 7 };
const line = (id: number, locationId = 1): OpeningStockSnapshotLine => ({
  variantId: `v${id}`, inventoryItemId: `inventory-${id}`, solvantisLocationId: locationId,
  locationName: `Store ${locationId}`, quantity: id % 5, wasNegative: false,
});
const snapshot = (lines: OpeningStockSnapshotLine[], offset = 0): OpeningStockSnapshot => ({
  version: 2, businessId: context.businessId, channelInstanceId: context.channelInstanceId,
  offset, expiresAt: Date.now() + 100_000, lines,
});

function database() {
  const headers = new Map<string, { id: number; status: string }>();
  const items: Array<{ stocktakeId: number; variant_id: string; counted_qty: number }> = [];
  const locations = [{ id: 1, name: 'Store 1', is_active: 1 }, { id: 2, name: 'Store 2', is_active: 1 }];
  const execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM ims_locations')) return [locations];
    if (sql.includes('FROM ims_stocktakes')) return [[headers.get(String(params[2]))].filter(Boolean)];
    if (sql.includes('INSERT INTO ims_stocktakes')) {
      const header = { id: headers.size + 1, status: 'draft' };
      headers.set(String(params[1]), header);
      return [{ insertId: header.id }];
    }
    if (sql.includes('INSERT INTO ims_stocktake_items')) {
      for (let i = 2; i < params.length - 2; i += 3) {
        items.push({ stocktakeId: Number(params[1]), variant_id: String(params[i]), counted_qty: Number(params[i + 1]) });
      }
    }
    if (sql.includes('UPDATE ims_stocktakes')) {
      const header = [...headers.values()].find(header => header.id === Number(params[0]));
      if (header) header.status = 'in_progress';
    }
    if (sql.includes('FROM ims_stocktake_items')) {
      return [items.filter(item => item.stocktakeId === Number(params[0]) && params.slice(1).includes(item.variant_id))];
    }
    return [{ affectedRows: 1 }];
  });
  const connection = { execute, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
  mocks.pool.mockReturnValue({ getConnection: vi.fn().mockResolvedValue(connection) });
  mocks.query.mockImplementation(async (_sql: string, params: unknown[]) =>
    params.slice(2).map(id => ({ variant_id: id, external_inventory_id: String(id).replace('v', 'inventory-') })));
  mocks.claim.mockResolvedValue({ replayed: false, operationId: 81 });
  mocks.apply.mockImplementation(async (_connection, input) => ({
    id: input.stocktakeId, status: 'completed', applied: 1, variances: 1, replayed: false,
  }));
  return { ...connection, headers, items, locations };
}

describe('Shopify opening stock document ownership', () => {
  beforeEach(() => vi.resetAllMocks());

  it('stages 947 variant lines from 106 batches into exactly ONE stocktake', async () => {
    const db = database();
    const snapshots = Array.from({ length: 106 }, (_, index) =>
      snapshot(Array.from({ length: index === 105 ? 2 : 9 }, (_, item) => line(index * 9 + item + 1)), index * 10));
    expect(await prepareOpeningStocktakes(context, snapshots)).toEqual([{ id: 1, location: 'Store 1', status: 'in_progress' }]);
    expect(db.headers.size).toBe(1);
    expect(db.items).toHaveLength(947);
    expect(new Set(db.items.map(item => item.variant_id)).size).toBe(947);
    expect(new Set(db.items.map(item => item.stocktakeId))).toEqual(new Set([1]));
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(db.execute.mock.calls.filter(([sql]) => sql.includes('INSERT INTO ims_stocktake_items'))).toHaveLength(4);
    expect(db.execute.mock.calls.some(([sql]) => sql.includes('UPDATE ims_stock SET') || sql.includes('INSERT INTO ims_stock_movements'))).toBe(false);
    expect(db.commit).toHaveBeenCalledOnce();
  });

  it('creates exactly one stocktake per location, regardless of batch count', async () => {
    const db = database();
    const batches = [snapshot([line(1), line(1, 2)]), snapshot([line(2), line(2, 2)], 10)];
    const result = await prepareOpeningStocktakes(context, batches);
    expect(result.map(document => document.id)).toEqual([1, 2]);
    expect(db.items).toHaveLength(4);
    for (const batch of batches) await applyOpeningStockBatch(context, batch);
    expect(mocks.apply.mock.calls.map(([, input]) => input.stocktakeId)).toEqual([1, 2, 1, 2]);
    expect(db.headers.size).toBe(2);
  });

  it('does not recreate headers or reset counted lines on preparation retry', async () => {
    const db = database();
    const batch = snapshot([line(1)]);
    await prepareOpeningStocktakes(context, [batch]);
    mocks.claim.mockResolvedValueOnce({ replayed: true, response: { id: 1, status: 'in_progress' } });
    expect(await prepareOpeningStocktakes(context, [batch])).toEqual([{ id: 1, location: 'Store 1', status: 'in_progress' }]);
    expect(db.headers.size).toBe(1);
    expect(db.items).toHaveLength(1);
    expect(mocks.complete).toHaveBeenCalledOnce();
  });

  it.each(['cancelled', 'reverted'])('rejects preparing an import whose document is %s', async status => {
    const db = database();
    db.headers.set(openingStocktakeReference(context.channelInstanceId, context.runId, 1), { id: 1, status });
    await expect(prepareOpeningStocktakes(context, [snapshot([line(1)])])).rejects.toThrow('cancelled or reversed');
    expect(db.rollback).toHaveBeenCalledOnce();
  });

  it('rejects duplicate batch offsets and duplicate location/variant lines', async () => {
    database();
    await expect(prepareOpeningStocktakes(context, [snapshot([line(1)]), snapshot([line(2)])])).rejects.toThrow('duplicate batches');
    await expect(prepareOpeningStocktakes(context, [snapshot([line(1)]), snapshot([line(1)], 10)])).rejects.toThrow('duplicate lines');
  });

  it('rejects changed exact-store inventory links before creating documents', async () => {
    const db = database();
    mocks.query.mockResolvedValueOnce([{ variant_id: 'v1', external_inventory_id: 'changed' }]);
    await expect(prepareOpeningStocktakes(context, [snapshot([line(1)])])).rejects.toThrow('no longer linked');
    expect(db.beginTransaction).not.toHaveBeenCalled();
  });

  it('requires preparation and exact staged quantities before applying', async () => {
    const db = database();
    const batch = snapshot([line(1)]);
    await expect(applyOpeningStockBatch(context, batch)).rejects.toThrow('Prepare the full');
    await prepareOpeningStocktakes(context, [batch]);
    db.items[0].counted_qty = 99;
    await expect(applyOpeningStockBatch(context, batch)).rejects.toThrow('do not match');
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('checks location activity during preparation and application', async () => {
    const db = database();
    const batch = snapshot([line(1)]);
    await prepareOpeningStocktakes(context, [batch]);
    db.locations[0].is_active = 0;
    await expect(applyOpeningStockBatch(context, batch)).rejects.toThrow('location changed');
    await expect(prepareOpeningStocktakes(context, [batch])).rejects.toThrow('location changed');
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('rolls back the whole batch when an application fails', async () => {
    const db = database();
    const batch = snapshot([line(1)]);
    await prepareOpeningStocktakes(context, [batch]);
    mocks.apply.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(applyOpeningStockBatch(context, batch)).rejects.toThrow('Database unavailable');
    expect(db.rollback).toHaveBeenCalledOnce();
    expect(db.release).toHaveBeenCalledTimes(2);
  });

  it('keeps document identity stable within a run and separate across stores and runs', () => {
    const ref = openingStocktakeReference('store-1', 'run-1', 1);
    expect(ref).toBe(openingStocktakeReference('store-1', 'run-1', 1));
    expect(ref).not.toBe(openingStocktakeReference('store-2', 'run-1', 1));
    expect(ref).not.toBe(openingStocktakeReference('store-1', 'run-2', 1));
    expect(ref).not.toBe(openingStocktakeReference('store-1', 'run-1', 2));
    expect(ref.length).toBeLessThanOrEqual(100);
  });
});
