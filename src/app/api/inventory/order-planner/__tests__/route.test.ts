import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StandardizedVariantWithSales } from '@/types/StandardizedData';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), tenant: vi.fn(), products: vi.fn(), suppliers: vi.fn(),
  branches: vi.fn(), stock: vi.fn(), sales: vi.fn(), execute: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mocks.auth, assertBusinessAccess: mocks.access }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.tenant }));
vi.mock('@/lib/dataProvider', () => ({
  getProductsWithSales: mocks.products, getSuppliers: mocks.suppliers, getBranches: mocks.branches, getStockPerBranch: mocks.stock,
}));
vi.mock('@/lib/ims/orderPlannerQuery', () => ({ getOrderPlannerBranchSales: mocks.sales }));
vi.mock('@/services/MySQLService', () => ({ execute: mocks.execute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

const product: StandardizedVariantWithSales = {
  source_type: 'solvantis', source_id: 'variant-1', parent_source_id: 'product-1',
  sku: 'SHIRT', barcode: null, name: 'Shirt', brand: 'Harbour', category: null,
  style_code: null, option_label: 'Default', cost: 10, price: 20, qty_on_hand: 100,
  qty_incoming: 20, global_available: 80, is_online: false, pack_size: 0, created_date: null,
  supplier_id: 'supplier-1', sales_qty_7d: 70, sales_qty_90d: 900, sales_qty_180d: 1800, sales_qty_12m: 3650,
};

function request(overrides: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/inventory/order-planner', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'preview', databaseId: 'business-1', filterType: 'brand', filterValue: 'Harbour',
      salesWindowDays: 90, orderFrequencyDays: 30, salesScope: 'selected', salesBranchIds: ['1'], ...overrides,
    }),
  });
}

describe('Order Planner branch scoping', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockReturnValue({ user: { businessId: 'business-1' } });
    mocks.access.mockReturnValue(null);
    mocks.tenant.mockImplementation(async (_businessId: string, work: () => Promise<unknown>) => work());
    mocks.products.mockResolvedValue([product]);
    mocks.suppliers.mockResolvedValue([]);
    mocks.branches.mockResolvedValue([{ source_id: '1', name: 'Sydney', is_active: true }, { source_id: '2', name: 'Melbourne', is_active: true }]);
    mocks.stock.mockResolvedValue([{ variant_id: 'variant-1', branch_id: '1', soh: 5, available: 5, incoming: 0 }]);
    mocks.sales.mockResolvedValue(new Map([['variant-1', 90]]));
    mocks.execute.mockResolvedValue({ insertId: 1 });
    mocks.report.mockResolvedValue(1);
  });

  it('resolves the authorized tenant before querying scoped sales or supply', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.rows[0]).toMatchObject({ salesQty: 90, totalAvailable: 5, suggestedQty: 25 });
    expect(mocks.tenant).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(mocks.tenant.mock.invocationCallOrder[0]).toBeLessThan(mocks.products.mock.invocationCallOrder[0]);
    expect(mocks.sales).toHaveBeenCalledWith(['1'], 90);
  });

  it('preserves cached all-branch results without issuing a branch sales query', async () => {
    const response = await POST(request({ salesScope: 'all', salesBranchIds: [] }));
    expect((await response.json()).rows[0]).toMatchObject({ salesQty: 900, totalAvailable: 80, suggestedQty: 200 });
    expect(mocks.sales).not.toHaveBeenCalled();
  });

  it('supports legacy branch selections without treating them as all branches', async () => {
    const response = await POST(request({ salesScope: undefined }));
    expect(response.status).toBe(200);
    expect(mocks.sales).toHaveBeenCalledWith(['1'], 90);
  });

  it.each([
    { salesBranchIds: [] }, { salesBranchIds: ['unknown'] }, { salesScope: 'all' },
    { salesWindowDays: 30 }, { action: 'unknown' },
  ])('rejects invalid scope instead of falling back to all branches: %j', async invalid => {
    const response = await POST(request(invalid));
    expect(response.status).toBe(400);
    expect(mocks.sales).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it.each(['products', 'suppliers', 'branches', 'stock', 'sales'] as const)('reports %s load failures instead of returning a successful zero plan', async source => {
    mocks[source].mockRejectedValue(new Error('database unavailable'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', source: 'ims-order-planner', operation: 'preview',
      reference: { type: 'business', id: 'business-1' },
    }));
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('withholds a suggestion if any selected branch has missing stock', async () => {
    const response = await POST(request({ salesBranchIds: ['1', '2'] }));
    expect((await response.json()).rows[0]).toMatchObject({
      totalAvailable: null, totalIncoming: null, suggestedQty: null, reorderQty: 0,
      missingStockBranchIds: ['2'], stockChecked: false,
    });
  });

  it('rejects a manual positive draft quantity without stock acknowledgement even when flags were forged', async () => {
    mocks.stock.mockResolvedValue([]);
    const response = await POST(request({
      action: 'save-draft', rows: [{ optionId: 'variant-1', code: 'SHIRT', reorderQty: 5, missingStockBranchIds: [] }],
    }));
    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('stores an acknowledged manual quantity with authoritative incomplete-stock flags and built scope', async () => {
    mocks.stock.mockResolvedValue([]);
    const response = await POST(request({
      action: 'save-draft', rows: [{ optionId: 'variant-1', code: 'SHIRT', reorderQty: 5, cost: 10, stockChecked: true }],
    }));
    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const saved = JSON.parse(mocks.execute.mock.calls[1][1][10]);
    expect(saved[0]).toMatchObject({
      reorderQty: 5, estimatedLineValue: 50, suggestedQty: null, totalAvailable: null,
      missingStockBranchIds: ['1'], stockChecked: true, salesBranchIds: ['1'],
    });
  });

  it('allows zero-quantity incomplete lines to be retained as warnings in the snapshot', async () => {
    mocks.stock.mockResolvedValue([]);
    const response = await POST(request({ action: 'save-draft', rows: [{ optionId: 'variant-1', code: 'SHIRT', reorderQty: 0 }] }));
    expect(response.status).toBe(200);
  });

  it('rejects another business before entering tenant context', async () => {
    mocks.access.mockReturnValue(new Response(null, { status: 403 }));
    const response = await POST(request({ databaseId: 'business-2' }));
    expect(response.status).toBe(403);
    expect(mocks.tenant).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests before reading tenant data', async () => {
    mocks.auth.mockReturnValue({ response: new Response(null, { status: 401 }) });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.tenant).not.toHaveBeenCalled();
    expect(mocks.products).not.toHaveBeenCalled();
  });

  it('reports failed draft saves without a success-shaped result', async () => {
    mocks.execute.mockRejectedValue(new Error('database unavailable'));
    const response = await POST(request({
      action: 'save-draft', rows: [{ optionId: 'variant-1', code: 'SHIRT', reorderQty: 5 }],
    }));
    expect(response.status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'save_draft',
    }));
  });
});
