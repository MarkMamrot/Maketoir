import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetImsSession, mockListAll, mockFindByBarcodeOrSku, mockFindIdentifierConflict, mockCreate } = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockListAll: vi.fn(),
  mockFindByBarcodeOrSku: vi.fn(),
  mockFindIdentifierConflict: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsVariantsRepo: {
    listAll: mockListAll,
    findByBarcodeOrSku: mockFindByBarcodeOrSku,
    findIdentifierConflict: mockFindIdentifierConflict,
    create: mockCreate,
  },
}));

import { GET as listVariants, POST as createVariant } from '../route';
import { GET as findVariantByBarcode } from '../by-barcode/route';

const READ_SESSIONS = ['marketoir_session', 'pos_session'];

describe('POS variant lookups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1', pos_user_id: 12 });
    mockListAll.mockResolvedValue([{ variant_id: 'variant-1', sku: 'SKU-1' }]);
    mockFindByBarcodeOrSku.mockResolvedValue({
      variant_id: 'variant-1',
      product_id: 'product-1',
      product_name: 'Test Product',
      sku: 'SKU-1',
      barcode: '123456',
    });
    mockFindIdentifierConflict.mockResolvedValue(null);
    mockCreate.mockResolvedValue('variant-2');
  });

  it('allows a POS session to list variants for transfer search', async () => {
    const response = await listVariants();

    expect(response.status).toBe(200);
    expect(mockGetImsSession).toHaveBeenCalledWith(READ_SESSIONS);
    expect(mockListAll).toHaveBeenCalledWith('business-1');
  });

  it('allows a POS session to find a variant by barcode or SKU', async () => {
    const response = await findVariantByBarcode(new Request('http://localhost/api/ims/variants/by-barcode?barcode=123456'));

    expect(response.status).toBe(200);
    expect(mockGetImsSession).toHaveBeenCalledWith(READ_SESSIONS);
    expect(mockFindByBarcodeOrSku).toHaveBeenCalledWith('123456');
  });

  it('rejects variant reads when neither admin nor POS session exists', async () => {
    mockGetImsSession.mockResolvedValue(null);

    expect((await listVariants()).status).toBe(401);
    expect((await findVariantByBarcode(new Request('http://localhost/api/ims/variants/by-barcode?barcode=123456'))).status).toBe(401);
    expect(mockListAll).not.toHaveBeenCalled();
    expect(mockFindByBarcodeOrSku).not.toHaveBeenCalled();
  });

  it('keeps variant creation restricted to the admin session default', async () => {
    const request = new Request('http://localhost/api/ims/variants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: 'SKU-2' }),
    });

    expect((await createVariant(request)).status).toBe(200);
    expect(mockGetImsSession).toHaveBeenCalledWith();
    expect(mockCreate).toHaveBeenCalledWith({ sku: 'SKU-2' }, 'business-1');
  });

  it('names the existing product when a variant SKU is already in use', async () => {
    mockFindIdentifierConflict.mockResolvedValue({
      product_id: 'product-1',
      product_name: 'Test Product',
      variant_id: 'variant-1',
      value: 'SKU-1',
    });
    const request = new Request('http://localhost/api/ims/variants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'product-2', sku: 'SKU-1' }),
    });

    const response = await createVariant(request);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Variant SKU "SKU-1" is already used by product "Test Product". Enter a unique Variant SKU.',
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});