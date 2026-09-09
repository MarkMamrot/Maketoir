import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ session: vi.fn(), search: vi.fn(), add: vi.fn() }));
vi.mock('@/app/api/ims/import/_helpers', () => ({ getImportSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsStocktakeRepo: { searchVariants: mocks.search, addItem: mocks.add },
}));

import { GET, POST } from '../route';

const params = { params: { id: '31' } };

describe('/api/ims/stocktakes/[id]/items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mocks.search.mockResolvedValue([{ variant_id: 'variant-1' }]);
  });

  it('supports an empty query for the initial browse dropdown', async () => {
    const request = new NextRequest('http://localhost/api/ims/stocktakes/31/items?q=&location_id=4');
    const response = await GET(request, params);

    expect(response.status).toBe(200);
    expect(mocks.search).toHaveBeenCalledWith('', 31, 4, 'biz-1');
    expect(await response.json()).toEqual({ matches: [{ variant_id: 'variant-1' }] });
  });

  it('keeps Advisor accounts from adding variants', async () => {
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    const request = new NextRequest('http://localhost/api/ims/stocktakes/31/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant_id: 'variant-1', location_id: 4 }),
    });

    expect((await POST(request, params)).status).toBe(403);
    expect(mocks.add).not.toHaveBeenCalled();
  });
});