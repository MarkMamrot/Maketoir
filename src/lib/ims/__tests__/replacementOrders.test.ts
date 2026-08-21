import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetIMSPool } = vi.hoisted(() => ({ mockGetIMSPool: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: mockGetIMSPool,
  imsExecute: vi.fn(),
  imsQuery: vi.fn(),
}));
vi.mock('@/services/imsContext', () => ({ getCurrentImsDb: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));
vi.mock('../backorders/domain', () => ({ getCustomerBackorderReadinessConflict: vi.fn() }));

import { ImsPORepo, ImsSORepo } from '../ImsRepository';

function mockConnection(execute: ReturnType<typeof vi.fn>) {
  const connection = {
    execute,
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
  mockGetIMSPool.mockReturnValue({ getConnection: vi.fn().mockResolvedValue(connection) });
  return connection;
}

beforeEach(() => vi.clearAllMocks());

describe('replacement order cloning', () => {
  it('creates one sanitized linked PO Draft with new lines and copied landed-cost plans', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT * FROM ims_purchase_orders')) return [[{
        id: 42, business_id: 'biz-1', po_number: 'PO-2026-0042', status: 'complete',
        supplier_id: 8, location_id: 4, notes: 'Seasonal order', payment_terms: '30 days',
        tax_treatment: 'ex_tax', tax_code: 'INPUT', currency_code: 'NZD', exchange_rate: 0.92,
        freight: 15, discount: 5, subtotal: 100, tax_amount: 10, total_amount: 120,
        supplier_invoice_number: 'INV-9', received_date: '2026-08-01', xero_bill_id: 'xero-1',
      }]];
      if (sql.includes('replacement_of_po_id = ?')) return [[]];
      if (sql.includes('FROM ims_purchase_order_items')) return [[{
        id: 91, variant_id: 'v-1', qty_ordered: 3, qty_received: 3, unit_cost: 20,
        discount_pct: 10, tax_rate: 0.1, line_total: 54, notes: 'Blue',
      }]];
      if (sql.includes('FROM ims_po_landed_costs')) return [[{
        id: 7, label: 'Duty', reference: 'D-1', amount: 12, sort_order: 0,
      }]];
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('MAX(CAST')) return [[{ max_seq: 42 }]];
      if (sql.includes('INSERT INTO ims_purchase_orders')) return [{ insertId: 88 }];
      return [{ affectedRows: 1 }];
    });
    const connection = mockConnection(execute);

    await expect(ImsPORepo.createReplacement(42, 'biz-1')).resolves.toEqual({ id: 88, replayed: false });

    const headerCall = execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO ims_purchase_orders'))!;
    expect(headerCall[0]).toContain('replacement_of_po_id');
    expect(headerCall[0]).not.toContain('supplier_invoice_number');
    expect(headerCall[0]).not.toContain('xero_bill_id');
    expect(headerCall[1]).toEqual([
      'biz-1', 'PO-2026-0043', 8, 4, 'Replacement for PO-2026-0042\n\nSeasonal order',
      '30 days', 'ex_tax', 'INPUT', 'NZD', 0.92, 15, 5, 100, 10, 120, 42,
    ]);
    const lineCall = execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO ims_purchase_order_items'))!;
    expect(lineCall[0]).toContain('qty_received');
    expect(lineCall[0]).not.toContain('(id,');
    expect(lineCall[1]).toEqual(['biz-1', 88, 'v-1', 3, 20, 10, 0.1, 54, 'Blue']);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_po_landed_costs'),
      ['biz-1', 88, 'Duty', 'D-1', 12, 0],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(execute.mock.calls.findIndex(([sql]) => sql.includes('RELEASE_LOCK')))
      .toBeGreaterThan(execute.mock.calls.findIndex(([sql]) => sql.includes('INSERT INTO ims_purchase_orders')));
  });

  it('returns the existing PO replacement on retry without cloning again', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT * FROM ims_purchase_orders')) return [[{ id: 42, status: 'cancelled' }]];
      if (sql.includes('replacement_of_po_id = ?')) return [[{ id: 88 }]];
      return [{ affectedRows: 1 }];
    });
    mockConnection(execute);

    await expect(ImsPORepo.createReplacement(42, 'biz-1')).resolves.toEqual({ id: 88, replayed: true });
    expect(execute).not.toHaveBeenCalledWith(expect.stringContaining('GET_LOCK'), expect.anything());
    expect(execute).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ims_purchase_orders'), expect.anything());
  });

  it('creates a sanitized linked SO Draft with the delivery snapshot but without customer PO or fulfilment identity', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT * FROM ims_sales_orders')) return [[{
        id: 52, business_id: 'biz-1', so_number: 'SO-2026-0052', status: 'fulfilled', so_type: 'b2b',
        customer_id: 9, customer_po_number: 'CUSTOMER-77', price_tier: 'wholesale', location_id: 4,
        delivery_address: '1 High St', delivery_address2: 'Rear dock', delivery_suburb: 'Fitzroy',
        delivery_city: 'Melbourne', delivery_state: 'VIC', delivery_postcode: '3065', delivery_country: 'Australia',
        notes: 'Deliver carefully', payment_terms: '14 days', tax_treatment: 'inc_tax', tax_code: 'OUTPUT',
        freight: 8, discount: 3, subtotal: 100, tax_amount: 10, total_amount: 115,
        currency_code: 'AUD', exchange_rate: 1, fulfilled_date: '2026-08-02', xero_invoice_id: 'xero-2',
        shopify_order_id: 'shopify-2', refunded_amount: 20,
      }]];
      if (sql.includes('replacement_of_so_id = ?')) return [[]];
      if (sql.includes('FROM ims_sales_order_items')) return [[{
        id: 101, variant_id: 'v-2', qty_ordered: 2, qty_fulfilled: 2, unit_price: 50,
        unit_cost: 20, discount_pct: 0, tax_rate: 0.1, line_total: 100, notes: null,
      }]];
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('MAX(CAST')) return [[{ max_seq: 52 }]];
      if (sql.includes('INSERT INTO ims_sales_orders')) return [{ insertId: 98 }];
      return [{ affectedRows: 1 }];
    });
    mockConnection(execute);

    await expect(ImsSORepo.createReplacement(52, 'biz-1')).resolves.toEqual({ id: 98, replayed: false });

    const headerCall = execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO ims_sales_orders'))!;
    expect(headerCall[0]).toContain('customer_po_number');
    expect(headerCall[0]).toContain('replacement_of_so_id');
    expect(headerCall[0]).not.toContain('fulfilled_date');
    expect(headerCall[0]).not.toContain('xero_invoice_id');
    expect(headerCall[0]).not.toContain('shopify_order_id');
    expect(headerCall[1]).toEqual([
      'biz-1', 'SO-2026-0053', 'b2b', 9, 'wholesale', 4,
      '1 High St', 'Rear dock', 'Fitzroy', 'Melbourne', 'VIC', '3065', 'Australia', '14 days',
      'Replacement for SO-2026-0052\n\nDeliver carefully', 'inc_tax', 'OUTPUT', 8, 3, 100, 10, 115, 'AUD', 1, 52,
    ]);
    const lineCall = execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO ims_sales_order_items'))!;
    expect(lineCall[0]).toContain('qty_fulfilled');
    expect(lineCall[0]).not.toContain('(id,');
    expect(lineCall[1]).toEqual(['biz-1', 98, 'v-2', 2, 50, 20, 0, 0.1, 100, null]);
  });
});