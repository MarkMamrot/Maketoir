import { describe, expect, it } from 'vitest';
import { buildProductProfitability, productProfitabilityCsv, type ProfitabilityProduct } from '../productProfitability';
import { emptyRow, type ReportRow } from '../cogsTraceability/domain';
import { projectReport, type SalesLine, type Movement } from '../cogsTraceability/projection';

const product: ProfitabilityProduct = { variantId: 'v1', sku: 'SKU1', name: 'Shirt', brand: 'Brand',
  supplierId: 1, productType: 'Apparel', category: 'Clothing', subcategory: 'Shirts' };
const line: SalesLine = { source: 'pos', documentId: 1, lineId: 1, variantId: 'v1', orderRef: 'POS1',
  invoiceNo: null, saleDate: '2026-10-01', customer: null, channel: 'POS', channelInstance: null,
  cashier: null, brand: 'Old Brand', sku: 'SKU1', description: 'Old Shirt', warehouse: 'Shop', locationId: 1,
  status: 'completed', currency: 'AUD', exchangeRate: 1, qty: 10, gross: 1100, lineTotal: 1100,
  taxRate: .1, taxBasis: 'inc_tax', headerDiscount: 0, headerNet: 1000, headerTax: 100,
  historical: false, stockItem: true, restock: true, creditRef: null, reversedAt: null };
const movement: Movement = { id: 1, documentId: 1, referenceType: 'pos_sale', sourceLineId: null,
  variantId: 'v1', locationId: 1, warehouse: 'Shop', date: '2026-10-02', type: 'pos_sale',
  qtyChange: -10, unitCost: 60, costMethod: 'fifo', historical: false, stockItem: true };
function project(lines = [line], movements = [movement]) {
  return projectReport({ lines, movements, basis: 'sale', from: '2026-10-01', toExclusive: '2026-11-01' });
}
function row(overrides: Partial<ReportRow> = {}): ReportRow {
  return { ...emptyRow('sale'), variantId: 'v1', sku: 'SKU1', qty: 1, netSales: 100,
    sales: 100, discount: 0, cogs: 60, gp: 40, gpPercent: 40, ...overrides };
}

describe('historical product profitability', () => {
  it('uses captured costs and extracts actual GST rather than catalogue estimates', () => {
    const result = buildProductProfitability(project(), [product]);
    expect(result.rows[0]).toMatchObject({ qty: 10, rev: expect.closeTo(1000, 6), cogs: 600, profit: expect.closeTo(400, 6), margin: expect.closeTo(40, 6) });
    expect(result.summary).toMatchObject({ netSales: expect.closeTo(1000, 6), gp: expect.closeTo(400, 6), gpPercent: expect.closeTo(40, 6) });
  });
  it('allocates recorded discounts before computing profit', () => {
    const result = buildProductProfitability(project([{ ...line, headerDiscount: 110, headerNet: 900, headerTax: 90 }]), [product]);
    expect(result.rows[0].rev).toBeCloseTo(900);
    expect(result.rows[0].profit).toBeCloseTo(300);
  });
  it('current catalogue classification does not rewrite historical financial amounts', () => {
    const original = buildProductProfitability(project(), [product]).rows[0];
    const changed = buildProductProfitability(project(), [{ ...product, name: 'Renamed', brand: 'New Brand' }]).rows[0];
    expect(changed).toMatchObject({ ...original, name: 'Renamed', brand: 'New Brand' });
  });
  it('does not substitute zero for missing captured costs', () => {
    const result = buildProductProfitability(project([line], [{ ...movement, unitCost: null }]), [product]);
    expect(result.rows[0]).toMatchObject({ rev: expect.closeTo(1000, 6), cogs: null, profit: null, margin: null, missingCosts: 1 });
    expect(result.summary).toMatchObject({ cogs: null, gp: null, missingCosts: 1 });
  });
  it('withholds partially fulfilled SO profit despite knowing some costs', () => {
    const result = buildProductProfitability(project([{ ...line, source: 'so' }],
      [{ ...movement, referenceType: 'sales_order', sourceLineId: 1, type: 'so_fulfilled', qtyChange: -4 }]), [product]);
    expect(result.rows[0]).toMatchObject({ qty: 10, rev: expect.closeTo(1000, 6), cogs: null, profit: null });
    expect(result.summary.knownCogs).toBe(240);
  });
  it('treats recorded zero cost as valid evidence', () => {
    const result = buildProductProfitability(project([line], [{ ...movement, unitCost: 0 }]), [product]);
    expect(result.rows[0]).toMatchObject({ cogs: 0, profit: expect.closeTo(1000, 6), margin: 100, missingCosts: 0 });
  });
  it('withholds imported history with unknown tax and currency evidence', () => {
    const result = buildProductProfitability(project([{ ...line, source: 'history', historical: true,
      currency: 'Unknown', exchangeRate: null, taxBasis: 'unknown' }], []), [product]);
    expect(result.rows[0]).toMatchObject({ qty: 10, rev: null, cogs: null, profit: null, missingRevenue: 1 });
  });
  it('handles tax-free and foreign currency sales using recorded treatment/rate', () => {
    const result = buildProductProfitability(project([{ ...line, taxBasis: 'no_tax', taxRate: 0,
      currency: 'USD', exchangeRate: 1.5, headerNet: 1100, headerTax: 0 }]), [product]);
    expect(result.rows[0]).toMatchObject({ rev: 1650, cogs: 600, profit: 1050 });
  });
  it('withholds revenue when the foreign exchange rate is unknown', () => {
    const result = buildProductProfitability(project([{ ...line, currency: 'USD', exchangeRate: null }]), [product]);
    expect(result.rows[0]).toMatchObject({ rev: null, cogs: 600, profit: null, missingRevenue: 1 });
  });
  it('accounts for credits and reversals without double counting linked POS returns', () => {
    const credit = { ...line, source: 'credit' as const, documentId: 2, lineId: 2, restock: false,
      qty: 1, gross: 110, lineTotal: 110, headerNet: 100, headerTax: 10 };
    const result = buildProductProfitability(project([line, credit], [movement]), [product]);
    expect(result.rows[0]).toMatchObject({ qty: 9, rev: expect.closeTo(900, 6), cogs: 600, profit: expect.closeTo(300, 6) });
    const reversed = buildProductProfitability(project([line, { ...credit, reversedAt: '2026-10-03' }], [movement]), [product]);
    expect(reversed.rows[0]).toMatchObject({ qty: 10, rev: expect.closeTo(1000, 6), cogs: 600, profit: expect.closeTo(400, 6) });
  });
  it('aggregates duplicate POS SKU lines without multiplying captured cost', () => {
    const half = { ...line, qty: 5, gross: 550, lineTotal: 550 };
    const result = buildProductProfitability(project([half, { ...half, lineId: 2 }]), [product]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ qty: 10, rev: expect.closeTo(1000, 6), cogs: 600, profit: expect.closeTo(400, 6) });
  });
  it('keeps freight/rounding out of product profit and counts excluded records', () => {
    const result = buildProductProfitability(project([{ ...line, headerNet: 1010 }]), [product]);
    expect(result.rows[0].rev).toBeCloseTo(1000);
    expect(result.excludedNonProductRecords).toBe(1);
  });
  it('keeps unmatched products visible and can resolve history by SKU', () => {
    const result = buildProductProfitability([row({ variantId: null }), row({ variantId: 'deleted', sku: 'OLD' })], [product]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find(item => item.sku === 'SKU1')?.variantId).toBe('v1');
    expect(result.rows.find(item => item.sku === 'OLD')?.variantId).toBe('deleted');
  });
  it.each([
    { productId: 'other' }, { brand: 'other' }, { supplierId: '2' },
    { productType: 'other' }, { category: 'other' }, { subcategory: 'other' },
  ])('applies current catalogue filters %j before totals', filter => {
    const result = buildProductProfitability([row()], [product], filter);
    expect(result.rows).toEqual([]);
    expect(result.summary).toMatchObject({ rows: 0, netSales: 0, cogs: 0, gp: 0, gpPercent: null });
  });
  it('withholds complete group and summary totals if even one member is incomplete', () => {
    const result = buildProductProfitability([row(), row({ id: 'missing', cogs: null, gp: null })], [product]);
    expect(result.rows[0]).toMatchObject({ rev: 200, cogs: null, profit: null, missingCosts: 1 });
    expect(result.summary).toMatchObject({ gp: null, knownCogs: 60 });
  });
  it('sorts complete profits first and preserves valid losses/zero revenue margins', () => {
    const result = buildProductProfitability([
      row({ variantId: 'a', sku: 'A', netSales: 0, cogs: 60, gp: -60 }),
      row({ variantId: 'b', sku: 'B', cogs: null, gp: null }), row(),
    ], [product]);
    expect(result.rows.map(item => item.sku)).toEqual(['SKU1', 'A', 'B']);
    expect(result.rows[1]).toMatchObject({ profit: -60, margin: null });
  });
  it('exports historical fields, evidence and blank unknowns, never catalogue unit prices/costs', () => {
    const result = buildProductProfitability([row({ cogs: null, gp: null })], [{ ...product, name: '=FORMULA' }]);
    const csv = productProfitabilityCsv(result.rows);
    expect(csv).toContain('Net Revenue (AUD ex GST)');
    expect(csv).toContain('Missing Cost Records');
    expect(csv).toContain('Incomplete');
    expect(csv).toContain("'=FORMULA");
    expect(csv).not.toMatch(/Unit Price|Unit Cost|NaN|null/);
    expect(csv).toContain('"100","","",""');
  });
});
