import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: { businessId: 'business-1' } as null | { businessId: string },
  imsQuery: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: vi.fn(() => mocks.session) }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));

import { GET } from '../route';

describe('IMS filter search route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { businessId: 'business-1' };
  });

  it('searches active tracked product variants for build component pickers', async () => {
    mocks.imsQuery.mockResolvedValueOnce([{
      variant_id: 'variant-1',
      sku: 'WICK-01',
      barcode: '930000000001',
      average_cost: 2.75,
      product_name: 'Candle Wick',
      brand: 'Workshop',
      option_label: 'Large',
    }]);

    const response = await GET(new Request('http://localhost/api/ims/filters/search?only=product&stock=1&q=wick&limit=25'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.suggestions).toEqual([expect.objectContaining({
      type: 'product',
      value: 'variant-1',
      averageCost: 2.75,
    })]);
    const [statement, params] = mocks.imsQuery.mock.calls[0];
    expect(statement).toContain('p.is_stock_item = 1');
    expect(statement).toContain('v.barcode LIKE ?');
    expect(params).toEqual(['business-1', '%wick%', '%wick%', '%wick%']);
  });
});
