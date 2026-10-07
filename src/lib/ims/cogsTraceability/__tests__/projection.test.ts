import { describe, expect, it } from 'vitest';
import { allocateRows, normaliseLines, projectReport, type Movement, type SalesLine } from '../projection';
import { summarise } from '../domain';

const line: SalesLine = { source: 'so', documentId: 1, lineId: 10, variantId: 'v', orderRef: 'SO1', invoiceNo: null,
  saleDate: '2026-10-01', customer: 'Customer', channel: 'Wholesale', channelInstance: null, cashier: null, brand: 'Brand',
  sku: 'SKU', description: 'Item', warehouse: 'Store', locationId: 1, status: 'fulfilled', currency: 'AUD', exchangeRate: 1,
  qty: 10, gross: 100, lineTotal: 100, taxRate: .1, taxBasis: 'ex_tax', headerDiscount: 10,
  headerNet: 90, headerTax: 9, historical: false, stockItem: true, restock: true, creditRef: null, reversedAt: null };
const movement: Movement = { id: 100, documentId: 1, referenceType: 'sales_order', sourceLineId: 10, variantId: 'v',
  locationId: 1, warehouse: 'Store', date: '2026-10-02', type: 'so_fulfilled', qtyChange: -10,
  unitCost: 5, costMethod: 'average_cost', historical: false, stockItem: true };
const report = (lines = [line], movements = [movement], basis: 'sale' | 'movement' = 'movement') => projectReport({ lines, movements, basis, from: '2026-10-01', toExclusive: '2026-11-01' });

describe('traceability projections', () => {
  it('allocates header discount once and uses captured costs', () => {
    expect(report()[0]).toMatchObject({ sales: 100, discount: 10, netSales: 90, cogs: 50, gp: 40, tax: 9 });
  });
  it('extracts GST from a POS order-wide discount before calculating net sales', () => {
    const rows = report([{ ...line, source: 'pos', gross: 110, lineTotal: 110, headerDiscount: 11,
      taxBasis: 'inc_tax', headerNet: 90, headerTax: 9 }], [{ ...movement, referenceType: 'pos_sale', type: 'pos_sale', sourceLineId: null }]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].sales)).toBeCloseTo(100);
    expect(Number(rows[0].netSales)).toBeCloseTo(90);
    expect(Number(rows[0].discount)).toBeCloseTo(10);
  });
  it('attributes partial shipments without repeating revenue', () => {
    const rows = report([line], [{ ...movement, qtyChange: -3 }, { ...movement, id: 101, qtyChange: -7 }]);
    expect(summarise(rows)).toMatchObject({ qty: 10, netSales: 90, cogs: 50 });
    expect(report([line], [{ ...movement, qtyChange: -3 }], 'sale')[0]).toMatchObject({ netSales: 90, cogs: null, gp: null });
  });
  it('does not create sale revenue for unmatched movements or unknown costs', () => {
    expect(report([], [movement])[0]).toMatchObject({ cogs: 50, netSales: null, gp: null });
    expect(report([line], [{ ...movement, unitCost: null }])[0].cogs).toBeNull();
  });
  it('combines duplicate POS SKU lines without multiplying cost', () => {
    const first = { ...line, source: 'pos' as const, qty: 5, gross: 50, lineTotal: 50, headerDiscount: 0, headerNet: 100, headerTax: 10 };
    const rows = report([first, { ...first, lineId: 11 }], [{ ...movement, referenceType: 'pos_sale', sourceLineId: null, type: 'pos_sale' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qty: 10, netSales: 100, cogs: 50 });
    expect(rows[0].quality).toContain('Aggregated');
  });
  it('leaves ambiguous legacy SO lines unmatched', () => {
    const first = { ...line, headerNet: 190, headerTax: 19 };
    const rows = report([first, { ...first, lineId: 11 }], [{ ...movement, sourceLineId: null }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].netSales).toBeNull();
  });
  it('does not multiply revenue when legacy stock-event quantities exceed the source line', () => {
    const rows = report([line], [{ ...movement, sourceLineId: null }, { ...movement, id: 101, sourceLineId: null }]);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.netSales == null && String(row.quality).includes('quantity exceeds'))).toBe(true);
    expect(summarise(rows).knownCogs).toBe(100);
  });
  it('treats no-restock refunds as financial-only, including later reversal', () => {
    const rows = report([{ ...line, source: 'credit', restock: false, reversedAt: '2026-10-03' }], []);
    expect(rows[0]).toMatchObject({ netSales: -90, cogs: 0, gp: -90 });
    expect(rows[1]).toMatchObject({ netSales: 90, cogs: 0 });
    expect(summarise(rows).netSales).toBe(0);
  });
  it('shows a reversal whose original financial event is outside the range', () => {
    const rows = report([{ ...line, source: 'credit', restock: false, saleDate: '2026-09-01', reversedAt: '2026-10-03' }], [], 'sale');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ netSales: 90, cogs: 0 });
  });
  it('does not apply edited POS prices to old stock events', () => {
    const rows = report([{ ...line, source: 'pos', gross: 110, lineTotal: 110, headerDiscount: 11, taxBasis: 'inc_tax' }], [
      { ...movement, referenceType: 'pos_sale', sourceLineId: null, type: 'pos_sale' },
      { ...movement, id: 101, referenceType: 'pos_sale', sourceLineId: null, type: 'pos_return', qtyChange: 10 },
      { ...movement, id: 102, referenceType: 'pos_sale', sourceLineId: null, type: 'pos_sale' },
    ]);
    expect(rows.every(row => row.netSales == null)).toBe(true);
    expect(summarise(rows).knownCogs).toBe(50);
  });
  it('keeps document freight and tax rounding separate from products', () => {
    const rows = normaliseLines([{ ...line, headerNet: 100, headerTax: 10 }]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ qty: 0, net: 10, tax: 1, stockItem: false });
  });
  it('preserves totals when drilling into several FIFO layers', () => {
    const rows = report();
    const allocations = [1, 2].map(id => ({ id, movementId: 100, layerId: id, parentLayerId: null, sourceType: 'po_receipt', poRef: `PO${id}`, receiptDate: '2026-09-01', qty: id === 1 ? 3 : 7, unitCost: 5, value: id === 1 ? 15 : 35, type: 'consume' }));
    expect(summarise(allocateRows(rows, allocations))).toMatchObject({ qty: 10, netSales: 90, cogs: 50 });
  });
  it('uses recorded layer values, not quantities, to split COGS and recomputes layer GP', () => {
    const rows = report([line], [{ ...movement, unitCost: 4.8 }]);
    const allocations = [
      { id: 1, movementId: 100, layerId: 1, parentLayerId: null, sourceType: 'po_receipt', poRef: 'PO1', receiptDate: '2026-09-01', qty: 3, unitCost: 2, value: 6, type: 'consume' },
      { id: 2, movementId: 100, layerId: 2, parentLayerId: null, sourceType: 'po_receipt', poRef: 'PO2', receiptDate: '2026-09-01', qty: 7, unitCost: 6, value: 42, type: 'consume' },
    ];
    const allocated = allocateRows(rows, allocations);
    expect(allocated[0]).toMatchObject({ qty: 3, netSales: 27, cogs: 6, gp: 21 });
    expect(Number(allocated[0].gpPercent)).toBeCloseTo(21 / 27 * 100);
    expect(summarise(allocated)).toMatchObject({ qty: 10, netSales: 90, cogs: 48, gp: 42 });
    expect(allocateRows(rows, allocations.slice(0, 1))[0]).toMatchObject({ batch: null, netSales: 90, cogs: 48 });
  });
  it('preserves signed restoration allocation costs and quantities', () => {
    const rows = report([{ ...line, source: 'credit' }], [{ ...movement, referenceType: 'credit_note', type: 'cn_returned', qtyChange: 10 }]);
    const allocations = [{ id: 1, movementId: 100, layerId: 1, parentLayerId: null, sourceType: 'po_receipt', poRef: 'PO1', receiptDate: '2026-09-01', qty: 10, unitCost: 5, value: 50, type: 'restore' }];
    expect(allocateRows(rows, allocations)[0]).toMatchObject({ qty: -10, netSales: -90, cogs: -50, gp: -40 });
  });
});