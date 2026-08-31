import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), apply: vi.fn(), normalize: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/productOpeningStock', () => ({
  applyProductOpeningStock: mocks.apply,
  normalizeProductOpeningStockLines: mocks.normalize,
  ProductOpeningStockError: class ProductOpeningStockError extends Error {},
}));
vi.mock('@/lib/ims/stocktakes/stocktakeOperations', () => ({
  StocktakeOperationConflict: class StocktakeOperationConflict extends Error {},
}));
vi.mock('@/lib/ims/inventoryDocumentLifecycle', () => ({
  InventoryDocumentLifecycleConflict: class InventoryDocumentLifecycleConflict extends Error {},
}));
vi.mock('@/lib/ims/inventoryDocumentOperations', () => ({
  InventoryDocumentOperationConflict: class InventoryDocumentOperationConflict extends Error {},
}));
vi.mock('@/lib/ims/creditNoteStatusCommands', () => ({
  InventoryDocumentRevisionConflict: class InventoryDocumentRevisionConflict extends Error {},
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';
import { ProductOpeningStockError } from '@/lib/ims/productOpeningStock';
import { InventoryDocumentOperationConflict } from '@/lib/ims/inventoryDocumentOperations';

const context = { params: { id: 'product-1' } };
function request(body: unknown) {
  return new Request('http://localhost/api/ims/products/product-1/opening-stock', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/ims/products/[id]/opening-stock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', userId: 7, name: 'Alex', email: 'alex@example.test' });
    mocks.normalize.mockReturnValue([{ variantId: 'variant-1', locationId: 3, quantity: 2, minQty: 1, reorderQty: 4 }]);
    mocks.apply.mockResolvedValue({ productId: 'product-1', locations: [{ locationId: 3, stocktakeId: 31, replayed: false }] });
    mocks.report.mockResolvedValue(undefined);
  });

  it('passes tenant, product, actor, and stable request context to the service', async () => {
    const response = await POST(request({ requestToken: 'request-token-123', lines: [{}] }), context);
    expect(response.status).toBe(200);
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', productId: 'product-1', requestToken: 'request-token-123', actorId: 7, actorName: 'Alex',
    }));
  });

  it('returns validation errors as 400 without reporting a Runtime Issue', async () => {
    mocks.normalize.mockImplementation(() => { throw new ProductOpeningStockError('Invalid lines.'); });
    const response = await POST(request({ lines: [] }), context);
    expect(response.status).toBe(400);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('maps altered operation replays to 409 without reporting a Runtime Issue', async () => {
    mocks.apply.mockRejectedValue(new InventoryDocumentOperationConflict('Request key was already used with different values.'));
    const response = await POST(request({ requestToken: 'request-token-123', lines: [{}] }), context);
    expect(response.status).toBe(409);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('reports unexpected operational failures', async () => {
    mocks.apply.mockRejectedValue(new Error('Database unavailable.'));
    const response = await POST(request({ requestToken: 'request-token-123', lines: [{}] }), context);
    expect(response.status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1', operation: 'apply_opening_stock' }));
  });
});