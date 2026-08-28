import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createProduct: vi.fn(),
  createVariant: vi.fn(),
  findIdentifierConflict: vi.fn(),
  listContacts: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsProductsRepo: {
    create: mocks.createProduct,
    findByBaseSku: vi.fn(),
    findByName: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
  },
  ImsVariantsRepo: {
    create: mocks.createVariant,
    findByBarcodeOrSku: vi.fn(),
    findIdentifierConflict: mocks.findIdentifierConflict,
    update: vi.fn(),
  },
  ImsBrandsRepo: { create: vi.fn() },
  ImsContactsRepo: { create: vi.fn(), list: mocks.listContacts },
  ImsStockRepo: {
    ensureZoneBinColumns: vi.fn(),
    ensureProductCategoryColumns: vi.fn(),
    upsert: vi.fn(),
  },
}));

import { POST } from '../route';

describe('POST /api/ims/products/bulk-import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ businessId: 'sage-business' });
    mocks.listContacts.mockResolvedValue([]);
    mocks.findIdentifierConflict.mockResolvedValue(null);
    mocks.createProduct.mockResolvedValue('product-1');
    mocks.createVariant.mockResolvedValue('variant-1');
  });

  it('derives variant SKU and ignores a client-provided override', async () => {
    const response = await POST(new Request('http://localhost/api/ims/products/bulk-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: [{
          action: 'new_product',
          product_name: 'Rain Coat',
          base_sku: 'RC',
          sku: 'CLIENT-OVERRIDE',
          option1_name: 'Size',
          option1_value: 'Large',
          option2_name: 'Colour',
          option2_value: 'Ocean Blue',
        }],
        autoCreateBrands: [],
        autoCreateSuppliers: [],
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.findIdentifierConflict).toHaveBeenCalledWith(
      'variant_sku',
      'RC-Large-OceanBlue',
      { excludeProductId: undefined, excludeVariantId: undefined },
      'sage-business',
    );
    expect(mocks.createVariant).toHaveBeenCalledWith(
      expect.objectContaining({ sku: 'RC-Large-OceanBlue' }),
      'sage-business',
    );
  });

  it('rejects an import conflict and names the existing product', async () => {
    mocks.findIdentifierConflict.mockImplementation(async (field: string) => field === 'barcode'
      ? { product_id: 'existing-product', product_name: 'Existing Rain Coat', variant_id: 'existing-variant', value: '930000000001' }
      : null);

    const response = await POST(new Request('http://localhost/api/ims/products/bulk-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: [{
          action: 'new_product',
          product_name: 'New Rain Coat',
          base_sku: 'NRC',
          barcode: '930000000001',
        }],
        autoCreateBrands: [],
        autoCreateSuppliers: [],
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Barcode "930000000001" for "New Rain Coat" conflicts with product "Existing Rain Coat". Enter a unique Barcode.',
    });
    expect(mocks.createProduct).not.toHaveBeenCalled();
    expect(mocks.createVariant).not.toHaveBeenCalled();
  });
});