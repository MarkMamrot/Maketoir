import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movement, SalesLine } from '../projection';

const mocks = vi.hoisted(() => ({ ims: vi.fn(), main: vi.fn(), accounting: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.ims }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.main }));
vi.mock('@/lib/xero/cogsCalculator', () => ({ calculateCogsForPeriod: mocks.accounting }));
import { loadEvidence } from '../repository';
import { buildReport } from '../service';
import { parseRequest } from '../request';

const line: SalesLine = { source: 'so', documentId: 1, lineId: 10, variantId: 'v', orderRef: 'SO1', invoiceNo: 'INV1',
  saleDate: '2026-10-01', customer: 'Customer', channel: 'shopify', channelInstance: 'store-1', cashier: null, brand: 'Brand',
  sku: 'SKU', description: 'Item', warehouse: 'Store', locationId: 1, status: 'fulfilled', currency: 'AUD', exchangeRate: 1,
  qty: 10, gross: 100, lineTotal: 100, taxRate: .1, taxBasis: 'ex_tax', headerDiscount: 10,
  headerNet: 90, headerTax: 9, historical: false, stockItem: true, restock: true, creditRef: null, reversedAt: null };
const movement: Movement = { id: 100, documentId: 1, referenceType: 'sales_order', sourceLineId: 10, variantId: 'v',
  locationId: 1, warehouse: 'Store', date: '2026-10-02', type: 'so_fulfilled', qtyChange: -10,
  unitCost: 5, costMethod: 'average_cost', historical: false, stockItem: true };
let lines: SalesLine[];
let movements: Movement[];

describe('traceability evidence and service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lines = [line, { ...line, documentId: 2, lineId: 20, orderRef: 'SO2', channelInstance: 'store-2' }];
    movements = [movement, { ...movement, id: 200, documentId: 2, sourceLineId: 20 }];
    mocks.main.mockResolvedValue([]);
    mocks.accounting.mockResolvedValue({ totalCOGS: 100, blocked: false });
    mocks.ims.mockImplementation(async (sql: string, params: unknown[]) => {
      expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
      expect(sql).toMatch(/^SELECT/);
      if (sql.includes('FROM ims_sales_orders so JOIN')) return lines;
      if (sql.includes('FROM ims_stock_movements sm')) return movements;
      return [];
    });
  });
  it('deduplicates stock events loaded by date and by document', async () => {
    const evidence = await loadEvidence('tenant-1', parseRequest(new URLSearchParams('from=2026-10-01&to=2026-10-07')));
    expect(evidence.movements).toHaveLength(2);
    expect(mocks.main).toHaveBeenCalledWith(expect.stringContaining('business_id = ?'), ['tenant-1', '1', '2']);
  });
  it('reports full filtered totals independently of page size', async () => {
    const result = await buildReport('tenant-1', parseRequest(new URLSearchParams('from=2026-10-01&to=2026-10-07&pageSize=1')));
    expect(result.rows).toHaveLength(1);
    expect(result.exportRows).toHaveLength(2);
    expect(result.summary).toMatchObject({ qty: 20, netSales: 180, cogs: 100, gp: 80 });
    expect(mocks.accounting).toHaveBeenCalledWith({ businessId: 'tenant-1', startDate: '2026-10-01', endDateExclusive: '2026-10-08' });
  });
  it('keeps null movement dates after dated rows even when sorting descending', async () => {
    lines.push({ ...line, documentId: 3, lineId: 30, orderRef: 'FREIGHT', variantId: null, stockItem: false });
    const result = await buildReport('tenant-1', parseRequest(new URLSearchParams('from=2026-10-01&to=2026-10-07&pageSize=3&sort=movementDate&direction=desc')));
    expect(result.rows.slice(0, 2).every(row => row.movementDate != null)).toBe(true);
    expect(result.rows[2]).toMatchObject({ orderRef: 'FREIGHT', movementDate: null });
  });
  it('applies summary metric filters to groups and preserves underlying quality counts', async () => {
    movements[1] = { ...movements[1], unitCost: null };
    const result = await buildReport('tenant-1', parseRequest(new URLSearchParams({ from: '2026-10-01', to: '2026-10-07', groups: 'channel', filters: JSON.stringify([{ field: 'netSales', operator: 'gte', value: '100' }]) })));
    expect(result.rows).toHaveLength(1);
    expect(result.summary).toMatchObject({ rows: 2, netSales: 180, cogs: null, knownCogs: 50, missingCosts: 1 });
  });
  it('does not mix original currencies when summarising', async () => {
    lines[1] = { ...lines[1], currency: 'USD', exchangeRate: 1.5 };
    const result = await buildReport('tenant-1', parseRequest(new URLSearchParams('from=2026-10-01&to=2026-10-07&groups=channel')));
    expect(result.summary.netSales).toBe(225);
    expect(result.summary.documentNetSales).toBeNull();
    expect(result.rows[0].currency).toBe('Mixed (AUD totals)');
  });
  it('preserves captured partial-fulfilment costs in sale-date groups and CSV rows', async () => {
    movements[0] = { ...movements[0], qtyChange: -3 };
    const result = await buildReport('tenant-1', parseRequest(new URLSearchParams('from=2026-10-01&to=2026-10-07&basis=sale&groups=channel')));
    expect(result.summary).toMatchObject({ cogs: null, knownCogs: 65, costedRecords: 2, missingCosts: 1, gp: null });
    expect(result.rows[0]).toMatchObject({ cogs: null, knownCogs: 65, costedRecords: 2, gp: null });
    expect(result.exportRows[0].knownCogs).toBe(65);
  });
  it('rejects excessive source ranges instead of truncating output', async () => {
    mocks.ims.mockResolvedValue(Array.from({ length: 50001 }, () => line));
    await expect(loadEvidence('tenant-1', parseRequest(new URLSearchParams()))).rejects.toThrow('no figures have been truncated');
  });
});