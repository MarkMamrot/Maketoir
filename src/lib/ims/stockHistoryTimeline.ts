/**
 * buildStockTimeline — pure function extracted from StockHistoryModal's useMemo.
 *
 * Takes the raw API payload and filters/accumulates it into an ordered timeline
 * array ready for rendering. Extracted here so it can be unit-tested independently
 * of the React component.
 */

export interface TimelineRow {
  rowKey: string;
  kind: 'opening' | 'movement';
  id: number;
  date: string;
  variant_id: string;
  location_name: string;
  variant_label: string | null;
  movement: any | null;
  /** qty change for on-hand movements; pre-existing SOH for opening rows */
  inOut: number;
  /** committed-qty delta for this row (SO commit/uncommit events) */
  committedDelta: number;
  /** running SOH total across all scoped keys after this row */
  sohAfter: number;
  committedAfter: number;
  availAfter: number;
}

// Movement types that touch qty_incoming or qty_committed — NOT qty_on_hand.
// Excluded from the on-hand SOH accumulator and from the display (po_approved
// only; SO commit types remain visible but contribute 0 to the SOH total).
const NON_ONHAND = new Set([
  'po_approved',
  'so_confirmed',
  'so_committed',
  'so_unconfirmed',
  'so_uncommitted',
]);

function key(variant_id: string, location_name: string): string {
  return `${variant_id}::${location_name}`;
}

export function buildStockTimeline(
  data: {
    openingBalances: any[];
    movements: any[];
    stockByLocation: any[];
  },
  selectedVariantId: string,
  branchFilter: string,
): TimelineRow[] {
  const inVariant = (vid: string) => !selectedVariantId || vid === selectedVariantId;
  const inBranch  = (name: string) => !branchFilter    || name === branchFilter;

  // Opening-balance rows (one per variant+location in scope).
  const openings: TimelineRow[] = data.openingBalances
    .filter((ob: any) => inVariant(ob.variant_id) && inBranch(ob.location_name))
    .map((ob: any) => ({
      rowKey: `ob-${ob.variant_id}-${ob.location_name}`,
      kind: 'opening',
      id: -1,
      date: ob.created_at,
      variant_id: ob.variant_id,
      location_name: ob.location_name,
      variant_label: null,
      movement: null,
      inOut: Number(ob.qty_after_soh ?? 0),
      committedDelta: 0,
      sohAfter: 0,
      committedAfter: 0,
      availAfter: 0,
    }))
    .sort((a, b) => a.location_name.localeCompare(b.location_name));

  // Movement rows — hide po_approved (internal approval step, not a physical event).
  const moves: TimelineRow[] = data.movements
    .filter((m: any) => inVariant(m.variant_id) && inBranch(m.location_name) && m.movement_type !== 'po_approved')
    .map((m: any) => ({
      rowKey: `m-${m.id}`,
      kind: 'movement',
      id: m.id,
      date: m.created_at,
      variant_id: m.variant_id,
      location_name: m.location_name,
      variant_label: m.variant_label ?? null,
      movement: m,
      inOut: Number(m.qty_change ?? 0),
      committedDelta: Number(m.committed_change ?? 0),
      sohAfter: 0,
      committedAfter: 0,
      availAfter: 0,
    }))
    .sort((a, b) => {
      const t = String(a.date).localeCompare(String(b.date));
      return t !== 0 ? t : a.id - b.id;
    });

  // Derive each opening row's committedDelta = live committed minus all
  // movement committed changes in the window (backward extrapolation).
  const baseline: Record<string, number> = {};
  data.stockByLocation.forEach((s: any) => {
    if (inVariant(s.variant_id) && inBranch(s.location_name))
      baseline[key(s.variant_id, s.location_name)] = Number(s.qty_committed ?? 0);
  });
  for (const m of moves)
    baseline[key(m.variant_id, m.location_name)] = (baseline[key(m.variant_id, m.location_name)] ?? 0) - m.committedDelta;
  for (const o of openings)
    o.committedDelta = baseline[key(o.variant_id, o.location_name)] ?? 0;

  const asc = [...openings, ...moves];

  // Forward pass — accumulate on-hand SOH.
  // Non-on-hand types (so_committed etc.) contribute 0 to the SOH running total.
  const soh: Record<string, number> = {};
  for (const r of asc) {
    const sohDelta = r.kind === 'movement' && NON_ONHAND.has(r.movement?.movement_type) ? 0 : r.inOut;
    soh[key(r.variant_id, r.location_name)] = (soh[key(r.variant_id, r.location_name)] ?? 0) + sohDelta;
    r.sohAfter = Object.values(soh).reduce((s, v) => s + v, 0);
  }

  // Backward pass — anchor committed to live value and walk back.
  const comm: Record<string, number> = {};
  data.stockByLocation.forEach((s: any) => {
    if (inVariant(s.variant_id) && inBranch(s.location_name))
      comm[key(s.variant_id, s.location_name)] = Number(s.qty_committed ?? 0);
  });
  for (let i = asc.length - 1; i >= 0; i--) {
    const r = asc[i];
    r.committedAfter = Object.values(comm).reduce((s, v) => s + v, 0);
    r.availAfter = r.sohAfter - r.committedAfter;
    comm[key(r.variant_id, r.location_name)] = (comm[key(r.variant_id, r.location_name)] ?? 0) - r.committedDelta;
  }

  // Display newest-first; opening balances sit at the bottom.
  return [...moves].reverse().concat([...openings].reverse());
}
