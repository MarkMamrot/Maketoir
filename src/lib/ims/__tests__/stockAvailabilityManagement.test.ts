import { describe, expect, it } from 'vitest';
import { buildStockAvailabilityManagementReport } from '../stockAvailabilityManagement';

describe('buildStockAvailabilityManagementReport', () => {
  it('summarizes demand sales value, incoming PO cost, and promise exceptions', () => {
    const report = buildStockAvailabilityManagementReport([
      {
        so_id: 10,
        so_item_id: 101,
        so_number: 'SO-10',
        customer_name: 'Customer',
        location_name: 'Main',
        sku: 'SKU-1',
        product_name: 'Product',
        qty_ordered: 10,
        qty_fulfilled: 2,
        unit_price: 22,
        discount_pct: 10,
        qty_allocated_remaining: 5,
        qty_ready: 2,
        incoming_cost: 24,
        promised_date: '2026-08-10',
        overdue_count: 1,
        at_risk_count: 1,
      },
      {
        so_id: 10,
        so_item_id: 102,
        so_number: 'SO-10',
        customer_name: 'Customer',
        location_name: 'Main',
        sku: 'SKU-2',
        product_name: 'Other',
        qty_ordered: 1,
        qty_fulfilled: 0,
        unit_price: 11,
        discount_pct: 0,
        qty_allocated_remaining: 1,
        qty_ready: 0,
        incoming_cost: 5,
        promised_date: '2026-08-20',
        overdue_count: 0,
        at_risk_count: 0,
      },
    ]);

    expect(report.rows[0]).toEqual(expect.objectContaining({
      outstanding: 8,
      unsourced: 3,
      unsourcedValue: 59.4,
      ready: 2,
      readyValue: 39.6,
      protectedIncoming: 3,
      protectedIncomingCost: 24,
      overdue: true,
      atRisk: true,
    }));
    expect(report.summary).toEqual({
      unsourcedUnits: 3,
      unsourcedValue: 59.4,
      readyUnits: 2,
      readyValue: 39.6,
      protectedIncomingUnits: 4,
      protectedIncomingCost: 29,
      overduePromises: 1,
      atRiskPromises: 1,
    });
  });

  it('caps over-allocation at outstanding demand', () => {
    const report = buildStockAvailabilityManagementReport([{
      so_id: 20, so_item_id: 201, so_number: 'SO-20', customer_name: 'Customer', location_name: 'Main',
      sku: null, product_name: 'Product', qty_ordered: 2, qty_fulfilled: 1, unit_price: 10, discount_pct: 0,
      qty_allocated_remaining: 3, qty_ready: 2, incoming_cost: 0, promised_date: null, overdue_count: 0, at_risk_count: 0,
    }]);
    expect(report.rows[0]).toEqual(expect.objectContaining({ outstanding: 1, ready: 1, protectedIncoming: 0, unsourced: 0 }));
  });
});