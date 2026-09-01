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
  };
});

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getSession }));
vi.mock('@/lib/ims/bulkProductSave', () => ({
  BulkProductValidationError: mocks.BulkProductValidationError,
  saveBulkProducts: mocks.saveBulkProducts,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));

import { POST } from '../route';

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
});