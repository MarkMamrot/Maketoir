import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  delete: vi.fn(),
  report: vi.fn(),
}));

vi.mock('@/app/api/ims/import/_helpers', () => ({ getImportSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsStocktakeRepo: { delete: mocks.delete } }));
vi.mock('@/lib/ims/inventoryDocumentHistory', () => ({ getInventoryDocumentActivityHistory: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/ims/stocktakes/stocktakeOperations', () => ({
  transitionStocktake: vi.fn(),
  StocktakeOperationConflict: class StocktakeOperationConflict extends Error {},
}));
vi.mock('@/lib/ims/inventoryDocumentLifecycle', () => ({
  hashInventoryDocumentRequest: vi.fn(),
  InventoryDocumentLifecycleConflict: class InventoryDocumentLifecycleConflict extends Error {},
}));
vi.mock('@/lib/ims/creditNoteStatusCommands', () => ({
  InventoryDocumentRevisionConflict: class InventoryDocumentRevisionConflict extends Error {},
}));
vi.mock('@/lib/ims/inventoryDocumentOperations', () => ({
  InventoryDocumentOperationConflict: class InventoryDocumentOperationConflict extends Error {},
}));

import { DELETE } from '../route';

const params = { params: { id: '31' } };

describe('DELETE /api/ims/stocktakes/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mocks.delete.mockResolvedValue(undefined);
  });

  it('requests guarded deletion for a newly started unsaved stocktake', async () => {
    const request = new NextRequest('http://localhost/api/ims/stocktakes/31?discard_uncommitted=1', { method: 'DELETE' });
    const response = await DELETE(request, params);

    expect(response.status).toBe(200);
    expect(mocks.delete).toHaveBeenCalledWith(31, 'biz-1', true);
  });

  it('keeps ordinary draft deletion separate from uncommitted discard', async () => {
    const request = new NextRequest('http://localhost/api/ims/stocktakes/31', { method: 'DELETE' });
    await DELETE(request, params);

    expect(mocks.delete).toHaveBeenCalledWith(31, 'biz-1', false);
  });

  it('keeps Advisor accounts read-only', async () => {
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    const request = new NextRequest('http://localhost/api/ims/stocktakes/31?discard_uncommitted=1', { method: 'DELETE' });

    expect((await DELETE(request, params)).status).toBe(403);
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});