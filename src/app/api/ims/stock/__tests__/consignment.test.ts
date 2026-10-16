import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), list: vi.fn(), run: vi.fn(), issue: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsStockRepo: { list: mocks.list } }));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: vi.fn() }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.issue }));
import { GET } from '../route';

describe('Stock Levels ownership filtering', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'tenant', tier: 'Admin' });
    mocks.run.mockImplementation((_businessId: string, callback: () => Promise<unknown>) => callback());
    mocks.list.mockResolvedValue([{ sku: 'OWN', is_consignment: 0 }, { sku: 'CON', is_consignment: 1 }]);
  });
  it('keeps all physical stock by default in callback-scoped tenant context', async () => {
    const body = await (await GET(new Request('http://localhost/api/ims/stock'))).json();
    expect(body.data).toHaveLength(2);
    expect(mocks.run).toHaveBeenCalledWith('tenant', expect.any(Function));
    expect(mocks.list).toHaveBeenCalledWith(undefined, undefined, 'tenant');
  });
  it.each([['owned', 'OWN'], ['consignment', 'CON']])('filters %s without changing quantities', async (ownership, sku) => {
    const body = await (await GET(new Request(`http://localhost/api/ims/stock?ownership=${ownership}`))).json();
    expect(body.data).toEqual([expect.objectContaining({ sku })]);
  });
  it('rejects unsupported ownership without querying stock or reporting an operational failure', async () => {
    const response = await GET(new Request('http://localhost/api/ims/stock?ownership=invalid'));
    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it('records operational failures rather than returning empty successful data', async () => {
    mocks.list.mockRejectedValue(new Error('Database unavailable'));
    const response = await GET(new Request('http://localhost/api/ims/stock'));
    expect(response.status).toBe(500);
    expect(mocks.issue).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'tenant', operation: 'load_stock' }));
  });
});
