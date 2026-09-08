import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: null as any,
  buildAndConfirm: vi.fn(),
  buildAndFulfil: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: vi.fn(() => mocks.session) }));
vi.mock('@/lib/ims/builds/salesOrderBuildService', () => ({
  buildAndConfirmSalesOrder: mocks.buildAndConfirm,
  buildAndFulfilSalesOrder: mocks.buildAndFulfil,
}));
vi.mock('@/lib/ims/builds/buildService', () => ({
  ProductBuildConflictError: class ProductBuildConflictError extends Error {
    code: string;
    details?: Record<string, unknown>;
    constructor(message: string, code: string, details?: Record<string, unknown>) {
      super(message); this.code = code; this.details = details;
    }
  },
}));
vi.mock('@/lib/ims/xeroHooks', () => ({ triggerSOXeroSync: vi.fn().mockResolvedValue(null) }));

import { ProductBuildConflictError } from '@/lib/ims/builds/buildService';
import { POST as buildConfirm } from '../route';
import { POST as buildFulfil } from '../../build-fulfil/route';

const context = { params: { id: '42' } };

describe('sales order build composites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { businessId: 'business-1', tier: 'Admin', userId: 7, name: 'Manager', email: 'manager@example.com' };
  });

  it('forwards consented recipe revisions to Build & Confirm', async () => {
    mocks.buildAndConfirm.mockResolvedValue({ soId: 42, status: 'confirmed', batchId: 9 });
    const response = await buildConfirm(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ operationKey: 'confirm-1', builds: [{ outputVariantId: 'kit', recipeRevision: 3 }] }),
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.buildAndConfirm).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', soId: 42, operationKey: 'confirm-1',
      builds: [{ outputVariantId: 'kit', recipeRevision: 3 }],
    }));
  });

  it('keeps Advisor accounts read-only for Build & Fulfil', async () => {
    mocks.session.tier = 'Advisor';
    const response = await buildFulfil(new Request('http://localhost', { method: 'POST', body: '{}' }), context);
    expect(response.status).toBe(403);
    expect(mocks.buildAndFulfil).not.toHaveBeenCalled();
  });

  it('returns a structured 409 when a consented preview is stale', async () => {
    mocks.buildAndFulfil.mockRejectedValue(new ProductBuildConflictError(
      'The build preview is stale.', 'sales_order_build_preview_stale', { changed: true },
    ));
    const response = await buildFulfil(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ operationKey: 'fulfil-1', shipmentQuantities: [{ itemId: 5, quantity: 2 }], builds: [] }),
    }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'sales_order_build_preview_stale', changed: true });
  });
});