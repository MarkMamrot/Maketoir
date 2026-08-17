import { describe, expect, it } from 'vitest';
import { summarizeStockAvailabilityRow } from '../stockAvailabilityWorkbench';

describe('summarizeStockAvailabilityRow', () => {
  it('separates received, incoming, and unsourced demand', () => {
    expect(summarizeStockAvailabilityRow({
      qty_ordered: '10',
      qty_fulfilled: '2',
      qty_allocated: '7',
      qty_received_assigned: '4',
      allocation_qty_fulfilled: '1',
      status: 'partially_fulfilled',
    }, '2026-08-17')).toEqual({
      outstanding: 8,
      protected: 6,
      ready: 3,
      incoming: 3,
      unsourced: 2,
      issues: ['unsourced', 'ready', 'incoming'],
    });
  });

  it('preserves overlapping at-risk, overdue, and held flags', () => {
    expect(summarizeStockAvailabilityRow({
      qty_ordered: 5,
      qty_allocated: 5,
      qty_received_assigned: 0,
      allocation_qty_fulfilled: 0,
      at_risk_count: 1,
      earliest_incoming_date: '2026-08-01',
      status: 'backordered',
    }, '2026-08-17').issues).toEqual(['at_risk', 'overdue', 'incoming', 'held']);
  });

  it('caps stale allocation totals at current outstanding demand', () => {
    expect(summarizeStockAvailabilityRow({
      qty_ordered: 5,
      qty_fulfilled: 4,
      qty_allocated: 5,
      qty_received_assigned: 5,
      allocation_qty_fulfilled: 2,
      status: 'confirmed',
    })).toMatchObject({ outstanding: 1, protected: 1, ready: 1, incoming: 0, unsourced: 0 });
  });
});