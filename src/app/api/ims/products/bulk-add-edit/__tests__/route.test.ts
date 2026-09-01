import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class BulkProductValidationError extends Error {
    readonly errors: Array<{ clientId: string; field: string; message: string }>;

    constructor(errors: Array<{ clientId: string; field: string; message: string }>) {
      super(errors[0]?.message || 'Validation failed.');
      this.errors = errors;
    }
  }
  return {
    BulkProductValidationError,
    getSession: vi.fn(),
    saveBulkProducts: vi.fn(),
    reportRuntimeIssue: vi.fn(),
    imsQuery: vi.fn(),
    refreshVariantCache: vi.fn(),
  };
});

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getSession }));
vi.mock('@/lib/ims/bulkProductSave', () => ({
  BulkProductValidationError: mocks.BulkProductValidationError,
  saveBulkProducts: mocks.saveBulkProducts,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: mocks.refreshVariantCache }));

import { GET, POST } from '../route';

function request(products: unknown[]) {
  return new Request('http://localhost/api/ims/products/bulk-add-edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ products }),
  });
}

describe('POST /api/ims/products/bulk-add-edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ businessId: 'business-1' });
    mocks.reportRuntimeIssue.mockResolvedValue(1);
  });

  it('returns field errors without reporting expected validation conflicts', async () => {
    mocks.saveBulkProducts.mockRejectedValue(new mocks.BulkProductValidationError([
      { clientId: 'variant-1', field: 'sku', message: 'Variant SKU "HLS-M" is already used.' },
    ]));

    const response = await POST(request([{ clientId: 'product-1' }]));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      errors: [{ clientId: 'variant-1', field: 'sku' }],
    });
    expect(mocks.reportRuntimeIssue).not.toHaveBeenCalled();
  });

  it('reports unexpected save failures with safe batch context', async () => {
    mocks.saveBulkProducts.mockRejectedValue(new Error('database unavailable'));

    const response = await POST(request([
      { clientId: 'product-1', name: 'Secret customer-facing product data' },
      { clientId: 'product-2' },
    ]));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'No products were saved. Please try again.',
    });
    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1',
      source: 'ims-products',
      operation: 'bulk_add_edit_save',
      context: { productCount: 2 },
    }));
    expect(JSON.stringify(mocks.reportRuntimeIssue.mock.calls[0][0])).not.toContain('Secret customer-facing product data');
  });

  it('refreshes affected stock variants after a successful commit', async () => {
    mocks.saveBulkProducts.mockResolvedValue({
      success: true,
      created: 1,
      updated: 0,
      mappings: [],
      stockVariantIds: ['variant-1'],
    });
    mocks.refreshVariantCache.mockResolvedValue(undefined);

    const response = await POST(request([{ clientId: 'product-1' }]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, created: 1, updated: 0, mappings: [] });
    expect(mocks.refreshVariantCache).toHaveBeenCalledWith(['variant-1']);
  });
});

describe('GET /api/ims/products/bulk-add-edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ businessId: 'business-1' });
  });

  it('loads one tenant-scoped product page with nested variant location stock', async () => {
    mocks.imsQuery
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{ product_id: 'product-1', name: 'Harbour Shirt' }])
      .mockResolvedValueOnce([{ variant_id: 'variant-1', product_id: 'product-1', sku: 'HLS-M' }])
      .mockResolvedValueOnce([{ variant_id: 'variant-1', location_id: 7, qty_on_hand: 4, min_qty: 2, reorder_qty: 3, zone: 'A', bin: '12' }]);

    const response = await GET(new Request('http://localhost/api/ims/products/bulk-add-edit?page=2&q=Harbour'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      page: 2,
      perPage: 50,
      products: [{ product_id: 'product-1', variants: [{ variant_id: 'variant-1', location_stock: [{ location_id: 7, qty_on_hand: 4 }] }] }],
    });
    expect(mocks.imsQuery).toHaveBeenCalledTimes(4);
    expect(mocks.imsQuery.mock.calls[0][1][0]).toBe('business-1');
    expect(mocks.imsQuery.mock.calls[1][0]).toContain('LIMIT 50 OFFSET 50');
    expect(mocks.imsQuery.mock.calls[1][1]).toEqual(['business-1', '%Harbour%', '%Harbour%', '%Harbour%', '%Harbour%', '%Harbour%']);
    expect(mocks.imsQuery.mock.calls[2][1]).toEqual(['business-1', 'product-1']);
    expect(mocks.imsQuery.mock.calls[3][1]).toEqual(['business-1', 'variant-1']);
    expect(mocks.imsQuery.mock.calls[3][0]).toContain('FROM ims_stock');
  });
});