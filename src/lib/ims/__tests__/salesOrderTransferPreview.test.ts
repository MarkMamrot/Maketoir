import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, previewSalesOrderSourcing } = vi.hoisted(() => ({
  execute: vi.fn(),
  previewSalesOrderSourcing: vi.fn(),
}));
const preflightSalesOrderXeroDocuments = vi.hoisted(() => vi.fn());

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(() => ({ execute })),
}));

vi.mock('../salesOrderSourcing', () => ({ previewSalesOrderSourcing }));
vi.mock('../orderTransfers/salesOrderXeroPreflight', () => ({ preflightSalesOrderXeroDocuments }));

import { previewSalesOrderTransfer } from '../orderTransfers/salesOrderPreview';

const source = {
  id: 7,
  so_number: 'SO-7',
  business_id: 'biz-1',
  customer_id: 10,
  customer_name: 'Acme Retail',
  location_id: 3,
  location_name: 'Warehouse',
  order_date: '2026-09-01',
  status: 'partially_fulfilled',
  currency_code: 'AUD',
  exchange_rate: 1,
  tax_treatment: 'inc_tax',
  tax_code: 'OUTPUT',
  payment_terms: 'Net 30',
  price_tier: 'wholesale',
  customer_po_number: 'PO-99',
  so_type: 'b2b',
  is_historical: 0,
  xero_invoice_id: null,
  has_payments: 0,
  has_submitted_shipment: 0,
  outstanding_quantity: 8,
  updated_at: '2026-09-01T10:00:00.000Z',
};

const eligible = {
  ...source,
  id: 8,
  so_number: 'SO-8',
  status: 'backordered',
  outstanding_quantity: 2,
};

const excluded = {
  ...source,
  id: 9,
  so_number: 'SO-9',
  location_id: 4,
  location_name: 'Other Store',
  xero_invoice_id: 'invoice-9',
  has_payments: 1,
  has_submitted_shipment: 1,
};

describe('sales order transfer preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preflightSalesOrderXeroDocuments.mockResolvedValue({});
    previewSalesOrderSourcing.mockResolvedValue({
      lines: [{
        soItemId: 11,
        variantId: 'variant-1',
        sku: 'SKU-1',
        productName: 'Blue Shirt',
        ordered: 10,
        outstanding: 8,
        availableNow: 3,
        allocatedIncoming: 4,
      }],
    });
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('so.id <> ?')) return [[eligible, excluded]];
      if (sql.includes('so.id = ?')) return [[source]];
      throw new Error(`Unexpected query: ${sql}`);
    });
  });

  it('builds line rules and separates eligible targets from explained exclusions', async () => {
    const preview = await previewSalesOrderTransfer({
      businessId: 'biz-1',
      sourceOrderId: 7,
    });

    expect(preview.source).toEqual({
      id: 7,
      orderNumber: 'SO-7',
      status: 'partially_fulfilled',
      updatedAt: '2026-09-01T10:00:00.000Z',
      conflicts: [],
    });
    expect(preview.lines).toEqual([expect.objectContaining({
      itemId: 11,
      processedQuantity: 2,
      rules: {
        outstanding: 8,
        unavailableNow: 5,
        readyNow: 3,
        allocatedIncoming: 4,
        unallocatedShortage: 1,
      },
    })]);
    expect(preview.eligibleTargets).toEqual([expect.objectContaining({
      id: 8,
      status: 'backordered',
      conflicts: [],
    })]);
    expect(preview.excludedTargets).toEqual([expect.objectContaining({
      id: 9,
      conflicts: [
        'Location does not match.',
        'Destination order has payments.',
        'Destination order has a Xero document that must be checked.',
        'Destination order has a submitted shipment.',
      ],
    })]);
  });

  it('scopes source, candidate, and sourcing reads to the requested tenant', async () => {
    await previewSalesOrderTransfer({ businessId: 'biz-1', sourceOrderId: 7 });

    expect(execute).toHaveBeenNthCalledWith(1, expect.any(String), ['biz-1', 7]);
    expect(previewSalesOrderSourcing).toHaveBeenCalledWith({ businessId: 'biz-1', soId: 7 });
    expect(execute).toHaveBeenNthCalledWith(2, expect.any(String), ['biz-1', 7, 10]);
  });

  it('reports source blockers separately from destination conflicts', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('so.id <> ?')) return [[]];
      if (sql.includes('so.id = ?')) return [[{
        ...source,
        xero_invoice_id: 'invoice-7',
        has_payments: 1,
        has_submitted_shipment: 1,
      }]];
      throw new Error(`Unexpected query: ${sql}`);
    });

    const preview = await previewSalesOrderTransfer({ businessId: 'biz-1', sourceOrderId: 7 });
    expect(preview.source.conflicts).toEqual([
      'Source order has payments.',
      'Source order has a Xero document that must be checked.',
      'Source order has a submitted shipment.',
    ]);
  });
});