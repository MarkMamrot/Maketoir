import { describe, expect, it } from 'vitest';
import {
  buildHistoricalValuation, inventoryValuationCsv, physicalMovementDelta, reconstructLayer,
  valuationDate, type HistoricalLayer, type HistoricalMovement, type HistoricalVariant, type ValuationResult,
} from '../inventoryValuation';

const variant: HistoricalVariant = {
  variant_id: 'v1', sku: 'SKU-1', name: 'Product', brand: 'Brand', supplier_name: 'Supplier',
  created_at: '2024-01-01 00:00:00', current_cost: 99,
};
const movement = (override: Partial<HistoricalMovement> = {}): HistoricalMovement => ({
  id: 1, variant_id: 'v1', location_id: 1, movement_type: 'po_received',
  qty_change: 10, qty_after_soh: 10, unit_cost: 20, created_at: '2026-01-01 00:00:00',
  cost_method_snapshot: 'average_cost', cost_epoch_id: null, average_cost_after: null, cost_repaired: false,
  ...override,
});
const layer = (override: Partial<HistoricalLayer> = {}): HistoricalLayer => ({
  id: 1, variant_id: 'v1', location_id: 1, original_quantity: 10, unit_cost: 20,
  created_at: '2026-01-01 00:00:00', allocations: [], ...override,
});
function calculate(overrides: Partial<Parameters<typeof buildHistoricalValuation>[0]> = {}) {
  return buildHistoricalValuation({
    variants: [variant], stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: 10 }],
    movements: [movement()], layers: [], epochs: [], cutoff: '2026-01-31 13:00:00.000', ...overrides,
  });
}

describe('inventory valuation dates', () => {
  it('defaults to business today, not UTC today', () => {
    expect(valuationDate(null, 'Australia/Sydney', new Date('2026-10-13T16:00:00Z'))).toEqual({
      asAt: '2026-10-14', today: '2026-10-14', historical: false, cutoff: '2026-10-14 13:00:00.000',
    });
  });
  it.each(['', '2026-02-30', '2026-2-01', 'no date', '0999-01-01'])('rejects invalid date %s', date => {
    expect(() => valuationDate(date, 'Australia/Sydney', new Date('2026-10-14T00:00:00Z'))).toThrow('valid date');
  });
  it('rejects future dates', () => {
    expect(() => valuationDate('2026-10-15', 'Australia/Sydney', new Date('2026-10-14T00:00:00Z'))).toThrow('future');
  });
  it.each([
    ['2026-10-03', '2026-10-03 14:00:00.000'],
    ['2026-10-04', '2026-10-04 13:00:00.000'],
    ['2026-04-04', '2026-04-04 13:00:00.000'],
    ['2026-04-05', '2026-04-05 14:00:00.000'],
  ])('uses the next local midnight across DST on %s', (date, cutoff) => {
    expect(valuationDate(date, 'Australia/Sydney', new Date('2026-10-14T00:00:00Z')).cutoff).toBe(cutoff);
  });
});

describe('historical physical stock and Average Cost', () => {
  it('replays receipts at weighted average and excludes later activity', () => {
    const result = calculate({
      stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: 22 }],
      movements: [
        movement(),
        movement({ id: 2, qty_change: 5, qty_after_soh: 15, unit_cost: 26, created_at: '2026-01-02 00:00:00' }),
        movement({ id: 3, movement_type: 'pos_sale', qty_change: -3, qty_after_soh: 12, unit_cost: 22, created_at: '2026-01-03 00:00:00' }),
        movement({ id: 4, qty_change: 10, qty_after_soh: 22, unit_cost: 100, created_at: '2026-02-01 00:00:00' }),
      ],
    });
    expect(result.data[0]).toMatchObject({ soh: 12, cost: 22, total_value: 264, cost_source: 'historical' });
    expect(result.warnings.incomplete_history_sku_count).toBe(0);
  });
  it('values the receipt boundary at $330, not 15 times receipt unit cost', () => {
    const result = calculate({
      stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: 15 }],
      movements: [movement(), movement({ id: 2, qty_change: 5, qty_after_soh: 15, unit_cost: 26 })],
    });
    expect(result.data[0]).toMatchObject({ soh: 15, cost: 22, total_value: 330 });
  });
  it.each(['po_approved', 'so_confirmed', 'so_unconfirmed', 'so_committed', 'so_uncommitted'])('ignores %s on-order/reservation changes', type => {
    expect(physicalMovementDelta(movement({ movement_type: type, qty_change: 100 }))).toBe(0);
  });
  it('distinguishes receipt reversals from nonphysical PO unapprovals', () => {
    expect(physicalMovementDelta(movement({ movement_type: 'po_unapproved', qty_change: -5, unit_cost: null }))).toBe(0);
    const result = calculate({
      stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: 10 }],
      movements: [
        movement(),
        movement({ id: 2, qty_change: 5, qty_after_soh: 15, unit_cost: 26 }),
        movement({ id: 3, movement_type: 'po_unapproved', qty_change: -5, qty_after_soh: 10, unit_cost: 26 }),
        movement({ id: 4, movement_type: 'po_unapproved', qty_change: -100, qty_after_soh: 10, unit_cost: null }),
      ],
    });
    expect(result.data[0]).toMatchObject({ soh: 10, cost: 20, total_value: 200 });
  });
  it('includes products that now have zero stock and history older than one year', () => {
    const result = calculate({
      stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: 0 }],
      movements: [movement({ created_at: '2024-02-01 00:00:00' }),
        movement({ id: 2, movement_type: 'pos_sale', qty_change: -10, qty_after_soh: 0, created_at: '2026-02-01 00:00:00' })],
    });
    expect(result.data[0]).toMatchObject({ soh: 10, total_value: 200 });
  });
  it('infers undated imported opening stock and uses current cost when no cost history exists', () => {
    const result = calculate({ movements: [] });
    expect(result.data[0]).toMatchObject({ soh: 10, cost: 99, total_value: 990, cost_source: 'current_fallback', inferred_opening: true });
    expect(result.warnings).toMatchObject({ inferred_opening_sku_count: 1, current_cost_sku_count: 1 });
  });
  it('does not treat a receipt cost as an existing opening average', () => {
    const result = calculate({
      movements: [movement({ qty_change: 5, qty_after_soh: 15, unit_cost: 26 })],
      stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: 15 }],
    });
    expect(result.data[0]).toMatchObject({ soh: 15, cost: 99, cost_source: 'current_fallback' });
  });
  it('uses a trustworthy average snapshot and ignores a repaired COGS snapshot', () => {
    const result = calculate({
      stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: 10 }],
      movements: [movement({ movement_type: 'pos_sale', qty_change: -1, qty_after_soh: 10, unit_cost: 7 })],
    });
    expect(result.data[0]).toMatchObject({ cost: 7, total_value: 70 });
    const repaired = calculate({ movements: [movement({ movement_type: 'pos_sale', qty_change: -1, qty_after_soh: 10, unit_cost: 7, cost_repaired: true })] });
    expect(repaired.data[0].cost_source).toBe('current_fallback');
  });
  it('excludes later-created products but accepts imported older movement evidence', () => {
    const future = { ...variant, created_at: '2026-02-01 00:00:00' };
    expect(calculate({ variants: [future], movements: [] }).data).toEqual([]);
    expect(calculate({ variants: [future] }).data[0].soh).toBe(10);
  });
  it('includes the last instant and excludes exact next-day midnight', () => {
    const result = calculate({
      cutoff: '2026-01-01 13:00:00.000',
      stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: 11 }],
      movements: [
        movement({ created_at: '2026-01-01 12:59:59.999' }),
        movement({ id: 2, qty_change: 1, qty_after_soh: 11, created_at: '2026-01-01 13:00:00.000' }),
      ],
    });
    expect(result.data[0].soh).toBe(10);
  });
  it('flags ledger discontinuities and negative historical positions', () => {
    const result = calculate({
      stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: -2 }],
      movements: [movement(), movement({ id: 2, qty_change: -3, qty_after_soh: -2, movement_type: 'pos_sale' })],
    });
    expect(result.warnings).toMatchObject({ incomplete_history_sku_count: 1, negative_position_count: 1 });
    expect(result.data).toEqual([]);
  });
  it('handles customer/supplier returns without treating returned source cost as the shared average', () => {
    const result = calculate({
      stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: 11 }],
      movements: [movement(),
        movement({ id: 2, movement_type: 'cn_returned', qty_change: 2, qty_after_soh: 12, unit_cost: 5 }),
        movement({ id: 3, movement_type: 'scn_returned', qty_change: -1, qty_after_soh: 11, unit_cost: 9 })],
    });
    expect(result.data[0]).toMatchObject({ soh: 11, cost: 20, total_value: 220 });
  });
  it('uses explicit build average snapshots and weighted restored components', () => {
    expect(calculate({ movements: [movement({ movement_type: 'build_output_produced', average_cost_after: 23 })] }).data[0].cost).toBe(23);
    const result = calculate({
      stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: 15 }],
      movements: [movement(), movement({ id: 2, movement_type: 'build_component_restored', qty_change: 5, qty_after_soh: 15, unit_cost: 26 })],
    });
    expect(result.data[0]).toMatchObject({ cost: 22, total_value: 330 });
  });
  it('does not reset the shared average to the original cost on a later stocktake reversal', () => {
    const result = calculate({
      stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: 17 }],
      movements: [
        movement(),
        movement({ id: 2, movement_type: 'stocktake', qty_change: -2, qty_after_soh: 8, unit_cost: 20 }),
        movement({ id: 3, qty_change: 7, qty_after_soh: 15, unit_cost: 35 }),
        movement({ id: 4, movement_type: 'stocktake_reverted', qty_change: 2, qty_after_soh: 17, unit_cost: 20 }),
      ],
    });
    expect(result.data[0]).toMatchObject({ soh: 17, cost: 27, total_value: 459 });
  });
  it('preserves historical zero cost and exposes missing cost', () => {
    expect(calculate({ movements: [movement({ unit_cost: 0 })] }).data[0]).toMatchObject({ cost: 0, cost_source: 'historical' });
    const result = calculate({ variants: [{ ...variant, current_cost: null }], movements: [] });
    expect(result.data[0]).toMatchObject({ cost_source: 'uncosted', total_value: 0 });
    expect(result.warnings.uncosted_sku_count).toBe(1);
  });
  it('resets historical averages on method changes without letting reservation events reset them', () => {
    const result = calculate({
      epochs: [{ id: 2, method: 'average_cost', started_at: '2026-01-02 00:00:00' }],
      stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: 9 }],
      movements: [movement(), movement({ id: 2, cost_epoch_id: 2, movement_type: 'pos_sale', qty_change: -1, qty_after_soh: 9, unit_cost: 7, created_at: '2026-01-03 00:00:00' }),
        movement({ id: 3, movement_type: 'po_approved', qty_change: 100, qty_after_soh: 9, created_at: '2026-01-04 00:00:00' })],
    });
    expect(result.data[0].cost).toBe(7);
    expect(calculate({ epochs: [{ id: 2, method: 'average_cost', started_at: '2026-01-02 00:00:00' }] }).data[0].cost_source).toBe('current_fallback');
  });
});

describe('historical FIFO', () => {
  const fifoEpoch = [{ id: 1, method: 'fifo' as const, started_at: '2025-12-31 00:00:00' }];
  it('reconstructs remaining historical layers, not today remaining balances', () => {
    const result = calculate({
      epochs: fifoEpoch,
      stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: 3 }],
      movements: [movement(),
        movement({ id: 2, qty_change: 5, qty_after_soh: 15, unit_cost: 26 }),
        movement({ id: 3, movement_type: 'pos_sale', qty_change: -12, qty_after_soh: 3 })],
      layers: [
        layer({ allocations: [{ quantity: 10, allocation_type: 'consume', created_at: '2026-01-02 00:00:00' }] }),
        layer({ id: 2, original_quantity: 5, unit_cost: 26, allocations: [
          { quantity: 2, allocation_type: 'consume', created_at: '2026-01-02 00:00:00' },
          { quantity: 3, allocation_type: 'consume', created_at: '2026-02-01 00:00:00' },
        ] }),
      ],
    });
    expect(result.data[0]).toMatchObject({ soh: 3, layer_quantity: 3, cost: 26, total_value: 78 });
    expect(result.reconciliation.status).toBe('balanced');
  });
  it('accounts for consumption restoration and inbound reversal only through the cutoff', () => {
    expect(reconstructLayer(layer({ allocations: [
      { quantity: 3, allocation_type: 'consume', created_at: '2026-01-02 00:00:00' },
      { quantity: 1, allocation_type: 'restore', created_at: '2026-01-03 00:00:00' },
      { quantity: 2, allocation_type: 'reverse_inbound', created_at: '2026-01-04 00:00:00' },
      { quantity: 2, allocation_type: 'restore', created_at: '2026-02-01 00:00:00' },
    ] }), '2026-01-31 13:00:00')).toBe(6);
  });
  it('rejects invalid quantities and unsupported allocation types', () => {
    expect(() => reconstructLayer(layer({ allocations: [{ quantity: 11, allocation_type: 'consume', created_at: '2026-01-02 00:00:00' }] }), '2026-01-31 00:00:00')).toThrow('invalid historical quantity');
    expect(() => reconstructLayer(layer({ allocations: [{ quantity: 1, allocation_type: 'mystery', created_at: '2026-01-02 00:00:00' }] }), '2026-01-31 00:00:00')).toThrow('Unsupported');
  });
  it('does not invent later-created layers on earlier dates', () => {
    expect(reconstructLayer(layer({ created_at: '2026-02-01 00:00:00' }), '2026-01-31 00:00:00')).toBe(0);
  });
  it('does not cancel equal and opposite location discrepancies', () => {
    const result = calculate({
      epochs: fifoEpoch, movements: [],
      stock: [{ variant_id: 'v1', location_id: 1, qty_on_hand: 3 }, { variant_id: 'v1', location_id: 2, qty_on_hand: 1 }],
      layers: [layer({ original_quantity: 2 }), layer({ id: 2, location_id: 2, original_quantity: 2 })],
    });
    expect(result.data[0].reconciliation_delta).toBe(0);
    expect(result.data[0].cost_source).toBe('current_fallback');
    expect(result.reconciliation).toMatchObject({ status: 'mismatch', mismatched_sku_count: 1, mismatched_location_count: 2 });
  });
  it('uses the epoch applicable at the cutoff even if a later switch exists', () => {
    const result = calculate({ epochs: [...fifoEpoch, { id: 2, method: 'average_cost', started_at: '2026-02-01 00:00:00' }], layers: [layer()] });
    expect(result.costing_method).toBe('fifo');
    expect(result.cost_epoch_id).toBe(1);
  });
  it('uses a flagged fallback when layers are absent rather than hiding the mismatch', () => {
    const result = calculate({ epochs: fifoEpoch });
    expect(result.data[0]).toMatchObject({ cost_source: 'current_fallback', total_value: 990 });
    expect(result.reconciliation.status).toBe('mismatch');
  });
  it('uses a flagged current-cost estimate when historical layers cover only part of the stock', () => {
    const result = calculate({ epochs: fifoEpoch, layers: [layer({ original_quantity: 8 })] });
    expect(result.data[0]).toMatchObject({ soh: 10, layer_quantity: 8, cost_source: 'current_fallback', total_value: 990 });
    expect(result.reconciliation.status).toBe('mismatch');
  });
});

describe('valuation export', () => {
  it('includes the loaded date and provenance, quotes values and leaves missing costs blank', () => {
    const result: ValuationResult = {
      success: true, ...calculate({ variants: [{ ...variant, sku: 'SKU,"1', current_cost: null }], movements: [] }),
      as_at: '2026-01-31', business_today: '2026-10-14', time_zone: 'Australia/Sydney', historical: true,
    };
    const csv = inventoryValuationCsv(result);
    expect(csv).toContain('"2026-01-31","Australia/Sydney","SKU,""1"');
    expect(csv).toContain('"Cost Source","Inferred Opening Stock"');
    expect(csv).toContain('"","10","","Cost unavailable","Yes"');
  });
});
