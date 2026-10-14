import { describe, expect, it } from 'vitest';

import { buildPlannerRows, calculateReorderSuggestion } from '../orderPlanner';
import type { StandardizedVariantWithSales, VariantBranchStock } from '@/types/StandardizedData';

const product: StandardizedVariantWithSales = {
  source_type: 'solvantis', source_id: 'variant-1', parent_source_id: 'product-1',
  sku: 'SHIRT', barcode: null, name: 'Shirt', brand: 'Harbour', category: null,
  style_code: null, option_label: 'Default', cost: 10, price: 20,
  qty_on_hand: 100, qty_incoming: 20, global_available: 80, is_online: false,
  pack_size: 0, created_date: null, supplier_id: 'supplier-1',
  sales_qty_7d: 70, sales_qty_90d: 900, sales_qty_180d: 1800, sales_qty_12m: 3650,
};

function plan(branches: string[], stock: VariantBranchStock[], sales = 90, window = 90) {
  return buildPlannerRows({
    products: [product], stockPerBranch: stock,
    supplierNameMap: new Map(), supplierLeadTimeMap: new Map(),
    filterType: 'brand', filterValue: 'Harbour', salesWindowDays: window,
    orderFrequencyDays: 30, salesBranchIds: branches,
    branchSalesQuantities: new Map([['variant-1', sales]]),
  })[0];
}

describe('branch-scoped planner rows', () => {
  it.each([7, 90, 180, 365])('preserves cached all-branch planning for the %s-day window', window => {
    expect(plan([], [], 1, window)).toMatchObject({
      salesQty: window * 10, totalAvailable: 80, totalIncoming: 20,
      avgDailySales: 10, suggestedQty: 200, reorderQty: 200, missingStockBranchIds: [],
    });
  });

  it('uses only selected sales and supply, not global or other-branch quantities', () => {
    expect(plan(['1'], [
      { variant_id: 'variant-1', branch_id: '1', soh: 7, available: 5, incoming: 0 },
      { variant_id: 'variant-1', branch_id: '2', soh: 1000, available: 1000, incoming: 500 },
    ])).toMatchObject({
      salesQty: 90, avgDailySales: 1, totalSOH: 7, totalAvailable: 5, totalIncoming: 0,
      suggestedQty: 25, reorderQty: 25, missingStockBranchIds: [],
    });
  });

  it('sums complete multi-branch stock and deduplicates selected branches', () => {
    expect(plan(['1', '2', '1'], [
      { variant_id: 'variant-1', branch_id: '1', soh: 5, available: 5, incoming: 0 },
      { variant_id: 'variant-1', branch_id: '2', soh: 12, available: 10, incoming: 3 },
    ], 180)).toMatchObject({
      totalSOH: 17, totalAvailable: 15, totalIncoming: 3, suggestedQty: 42,
      salesBranchIds: ['1', '2'], missingStockBranchIds: [],
    });
  });

  it('withholds unknown stock and suggestions instead of falling back to business totals', () => {
    expect(plan(['1'], [])).toMatchObject({
      salesQty: 90, totalSOH: null, totalAvailable: null, totalIncoming: null,
      suggestedQty: null, reorderQty: 0, estimatedLineValue: 0,
      missingStockBranchIds: ['1'], stockChecked: false,
    });
  });

  it('requires coverage for every selected branch, not just one of them', () => {
    expect(plan(['1', '2'], [
      { variant_id: 'variant-1', branch_id: '1', soh: 5, available: 5, incoming: 0 },
    ])).toMatchObject({ missingStockBranchIds: ['2'], totalAvailable: null, suggestedQty: null, reorderQty: 0 });
  });

  it('distinguishes a confirmed zero stock row from missing data', () => {
    expect(plan(['1'], [
      { variant_id: 'variant-1', branch_id: '1', soh: 0, available: 0, incoming: 0 },
    ])).toMatchObject({ totalAvailable: 0, suggestedQty: 30, reorderQty: 30, missingStockBranchIds: [] });
  });

  it('does not substitute global sales when the selected branch has no matching sales', () => {
    expect(plan(['1'], [
      { variant_id: 'variant-1', branch_id: '1', soh: 0, available: 0, incoming: 0 },
    ], 0)).toMatchObject({ salesQty: 0, suggestedQty: 0, reorderQty: 0 });
  });
});

describe('calculateReorderSuggestion', () => {
  it('uses sales velocity across cadence and lead time, then subtracts available and incoming stock', () => {
    expect(calculateReorderSuggestion({
      salesQuantity: 90,
      salesWindowDays: 90,
      createdDate: null,
      supplierLeadTimeDays: 14,
      orderFrequencyDays: 30,
      availableQuantity: 8,
      incomingQuantity: 10,
      packSize: 0,
      now: Date.parse('2026-09-05T00:00:00Z'),
    })).toEqual({
      daysInStock: 90,
      effectiveSalesDays: 90,
      averageDailySales: 1,
      coverageDays: 44,
      suggestedQuantity: 26,
      reorderQuantity: 26,
    });
  });

  it('uses the shorter selling history for a new product and rounds to its pack size', () => {
    expect(calculateReorderSuggestion({
      salesQuantity: 10,
      salesWindowDays: 90,
      createdDate: '2026-08-12T00:00:00Z',
      supplierLeadTimeDays: 4,
      orderFrequencyDays: 10,
      availableQuantity: 1,
      incomingQuantity: 0,
      packSize: 6,
      now: Date.parse('2026-09-05T00:00:00Z'),
    })).toEqual({
      daysInStock: 20,
      effectiveSalesDays: 20,
      averageDailySales: 0.5,
      coverageDays: 14,
      suggestedQuantity: 6,
      reorderQuantity: 6,
    });
  });
});
