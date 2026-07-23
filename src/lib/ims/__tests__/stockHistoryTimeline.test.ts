import { describe, it, expect } from 'vitest';
import { buildStockTimeline } from '../stockHistoryTimeline';

// ─── helpers ──────────────────────────────────────────────────────────────────

function mkMovement(overrides: Record<string, any>) {
  return {
    id: Math.floor(Math.random() * 100000),
    variant_id: 'v1',
    location_name: 'Warehouse',
    movement_type: 'po_received',
    reference_type: 'purchase_order',
    reference_id: 1,
    qty_change: 0,
    committed_change: 0,
    created_at: '2026-01-15 10:00:00',
    variant_label: 'One Size',
    ...overrides,
  };
}

function mkOpening(overrides: Record<string, any> = {}) {
  return {
    variant_id: 'v1',
    location_name: 'Warehouse',
    qty_after_soh: 0,
    created_at: '2025-01-01 00:00:00',
    ...overrides,
  };
}

function mkStock(overrides: Record<string, any> = {}) {
  return {
    variant_id: 'v1',
    location_name: 'Warehouse',
    qty_on_hand: 0,
    qty_incoming: 0,
    qty_committed: 0,
    ...overrides,
  };
}

// ─── SOH accumulation ─────────────────────────────────────────────────────────

describe('buildStockTimeline — SOH accumulation', () => {
  it('accumulates po_received correctly', () => {
    const data = {
      openingBalances: [mkOpening({ qty_after_soh: 0 })],
      movements: [
        mkMovement({ id: 1, qty_change: 5, created_at: '2026-03-01 10:00:00' }),
        mkMovement({ id: 2, qty_change: 3, created_at: '2026-04-01 10:00:00' }),
      ],
      stockByLocation: [mkStock({ qty_on_hand: 8 })],
    };

    const rows = buildStockTimeline(data, '', '');
    // Timeline is newest-first: id=2, id=1, opening
    const [r2, r1, ob] = rows;

    expect(r2.sohAfter).toBe(8);
    expect(r1.sohAfter).toBe(5);
    expect(ob.sohAfter).toBe(0);
  });

  it('does NOT count po_approved in SOH — the double-count bug', () => {
    // Reproduces the Fluffy Knit Jumper bug: po_approved + po_received for
    // the same PO made SOH appear doubled (30 instead of 15).
    const data = {
      openingBalances: [mkOpening({ qty_after_soh: 0 })],
      movements: [
        // po_approved fires first (draft→confirmed): must NOT add to SOH
        mkMovement({ id: 10, movement_type: 'po_approved', qty_change: 10, created_at: '2026-07-22 09:00:00' }),
        // po_received fires second (actual receipt): DOES add to SOH
        mkMovement({ id: 11, movement_type: 'po_received', qty_change: 10, created_at: '2026-07-22 10:00:00' }),
      ],
      stockByLocation: [mkStock({ qty_on_hand: 10 })],
    };

    const rows = buildStockTimeline(data, '', '');

    // po_approved must be hidden from the timeline
    expect(rows.every(r => r.movement?.movement_type !== 'po_approved')).toBe(true);

    // Only po_received should have contributed to SOH
    const received = rows.find(r => r.movement?.movement_type === 'po_received');
    expect(received?.sohAfter).toBe(10);

    // Opening balance SOH should be 0, not -10
    const ob = rows.find(r => r.kind === 'opening');
    expect(ob?.sohAfter).toBe(0);
  });

  it('handles multiple variants across branches (combined view)', () => {
    const data = {
      openingBalances: [
        mkOpening({ variant_id: 'v1', location_name: 'Shop', qty_after_soh: 0 }),
        mkOpening({ variant_id: 'v2', location_name: 'Warehouse', qty_after_soh: 0 }),
      ],
      movements: [
        mkMovement({ id: 1, variant_id: 'v1', location_name: 'Shop',      qty_change: 4, created_at: '2026-05-01 10:00:00' }),
        mkMovement({ id: 2, variant_id: 'v2', location_name: 'Warehouse', qty_change: 6, created_at: '2026-06-01 10:00:00' }),
      ],
      stockByLocation: [
        mkStock({ variant_id: 'v1', location_name: 'Shop',      qty_on_hand: 4 }),
        mkStock({ variant_id: 'v2', location_name: 'Warehouse', qty_on_hand: 6 }),
      ],
    };

    const rows = buildStockTimeline(data, '', '');
    // Latest row (id=2, warehouse v2 receive) should show combined SOH = 4+6 = 10
    const r2 = rows.find(r => r.id === 2);
    expect(r2?.sohAfter).toBe(10);
  });

  it('filters to a single variant when selectedVariantId is set', () => {
    const data = {
      openingBalances: [
        mkOpening({ variant_id: 'v1', qty_after_soh: 0 }),
        mkOpening({ variant_id: 'v2', qty_after_soh: 0 }),
      ],
      movements: [
        mkMovement({ id: 1, variant_id: 'v1', qty_change: 5 }),
        mkMovement({ id: 2, variant_id: 'v2', qty_change: 9 }),
      ],
      stockByLocation: [
        mkStock({ variant_id: 'v1', qty_on_hand: 5 }),
        mkStock({ variant_id: 'v2', qty_on_hand: 9 }),
      ],
    };

    const rows = buildStockTimeline(data, 'v1', '');
    // Only v1 rows should appear
    expect(rows.every(r => r.variant_id === 'v1')).toBe(true);
    const m1 = rows.find(r => r.id === 1);
    expect(m1?.sohAfter).toBe(5);
  });

  it('filters to a single branch when branchFilter is set', () => {
    const data = {
      openingBalances: [
        mkOpening({ location_name: 'Shop',      qty_after_soh: 0 }),
        mkOpening({ location_name: 'Warehouse', qty_after_soh: 0 }),
      ],
      movements: [
        mkMovement({ id: 1, location_name: 'Shop',      qty_change: 4 }),
        mkMovement({ id: 2, location_name: 'Warehouse', qty_change: 7 }),
      ],
      stockByLocation: [
        mkStock({ location_name: 'Shop',      qty_on_hand: 4 }),
        mkStock({ location_name: 'Warehouse', qty_on_hand: 7 }),
      ],
    };

    const rows = buildStockTimeline(data, '', 'Shop');
    expect(rows.every(r => r.location_name === 'Shop')).toBe(true);
    const m = rows.find(r => r.id === 1);
    expect(m?.sohAfter).toBe(4); // should NOT include Warehouse's 7
  });
});

// ─── committed / available tracking ──────────────────────────────────────────

describe('buildStockTimeline — committed / available', () => {
  it('so_committed does not change SOH After but reduces Avail After', () => {
    const data = {
      openingBalances: [mkOpening({ qty_after_soh: 10 })],
      movements: [
        mkMovement({ id: 1, movement_type: 'po_received', qty_change: 10, created_at: '2026-02-01 09:00:00' }),
        mkMovement({ id: 2, movement_type: 'so_committed', qty_change: 3, committed_change: 3, created_at: '2026-03-01 09:00:00' }),
      ],
      stockByLocation: [mkStock({ qty_on_hand: 10, qty_committed: 3 })],
    };

    const rows = buildStockTimeline(data, '', '');
    const soRow = rows.find(r => r.movement?.movement_type === 'so_committed');
    const rcvRow = rows.find(r => r.movement?.movement_type === 'po_received');

    // so_committed should NOT inflate SOH
    expect(soRow?.sohAfter).toBe(rcvRow?.sohAfter);
    // but should reduce availability
    expect(soRow!.availAfter).toBeLessThan(soRow!.sohAfter);
  });

  it('opening balance committed shows — (not a transaction commit event)', () => {
    // The opening balance carries pre-existing committed qty into the window.
    // Its committedDelta is set so the backward pass works, but the UI must
    // display it as '—' (tested by checking the value is set but not shown).
    const data = {
      openingBalances: [mkOpening({ qty_after_soh: 0 })],
      movements: [],
      stockByLocation: [mkStock({ qty_on_hand: 0, qty_committed: 1 })],
    };

    const rows = buildStockTimeline(data, '', '');
    const ob = rows.find(r => r.kind === 'opening');

    // The opening row will have committedDelta = 1 (carried forward from live committed)
    // The render layer shows '—' for opening rows regardless — this tests the
    // underlying value is non-zero so we know the avail calc is correct.
    expect(ob?.committedDelta).toBe(1);
    // Available after should reflect the committed stock (0 on-hand − 1 committed = −1)
    expect(ob?.availAfter).toBe(-1);
  });
});

// ─── ordering ─────────────────────────────────────────────────────────────────

describe('buildStockTimeline — ordering', () => {
  it('returns newest movements first, opening balances last', () => {
    const data = {
      openingBalances: [mkOpening()],
      movements: [
        mkMovement({ id: 1, qty_change: 5, created_at: '2026-01-01 10:00:00' }),
        mkMovement({ id: 2, qty_change: 3, created_at: '2026-06-01 10:00:00' }),
      ],
      stockByLocation: [mkStock({ qty_on_hand: 8 })],
    };

    const rows = buildStockTimeline(data, '', '');
    expect(rows[0].id).toBe(2);      // newest first
    expect(rows[1].id).toBe(1);
    expect(rows[2].kind).toBe('opening'); // opening at bottom
  });

  it('breaks same-timestamp ties by movement id (ascending)', () => {
    const ts = '2026-07-22 10:00:00';
    const data = {
      openingBalances: [],
      movements: [
        mkMovement({ id: 20, qty_change: 3, created_at: ts }),
        mkMovement({ id: 10, qty_change: 5, created_at: ts }),
      ],
      stockByLocation: [mkStock({ qty_on_hand: 8 })],
    };

    const rows = buildStockTimeline(data, '', '');
    // Newest-first means id=20 appears before id=10 in display
    expect(rows[0].id).toBe(20);
    expect(rows[1].id).toBe(10);
  });
});
