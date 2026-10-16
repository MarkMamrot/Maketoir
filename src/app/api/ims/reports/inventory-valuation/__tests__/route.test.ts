import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  session: vi.fn(), query: vi.fn(), timeZone: vi.fn(), historical: vi.fn(), issue: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: mocks.timeZone }));
vi.mock('@/lib/ims/inventoryValuation.server', () => ({ loadHistoricalValuation: mocks.historical }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.issue }));
import { GET } from '../route';

describe('Inventory Valuation date routing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T16:00:00Z'));
    mocks.session.mockResolvedValue({ businessId: 'tenant-1' });
    mocks.timeZone.mockResolvedValue('Australia/Sydney');
    mocks.query.mockResolvedValue([]);
    mocks.issue.mockResolvedValue(1);
  });
  afterEach(() => vi.useRealTimers());
  const request = (query = '') => new Request(`http://localhost/api/ims/reports/inventory-valuation${query}`);
  it.each(['', '?asAt=2026-10-14'])('keeps today on the existing live Average Cost path: %s', async query => {
    mocks.query.mockResolvedValueOnce([{ active_method: 'average_cost', active_epoch_id: null }])
      .mockResolvedValueOnce([{ variant_id: 'v1', sku: 'SKU', cost: '7', soh: '3', total_value: '21', layer_quantity: null }]);
    const response = await GET(request(query));
    expect(await response.json()).toMatchObject({
      success: true, as_at: '2026-10-14', historical: false, costing_method: 'average_cost',
      data: [{ cost: 7, soh: 3, total_value: 21 }],
    });
    expect(mocks.historical).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[1][0]).toContain('COALESCE(SUM(s.qty_on_hand), 0)');
    expect(mocks.query.mock.calls[1][0]).toContain('v.is_active = 1');
    expect(mocks.query.mock.calls[1][0]).not.toContain('ims_stock_movements');
  });
  it.each(['', '?asAt=2026-10-14'])('keeps today on current FIFO layers and location reconciliation: %s', async query => {
    mocks.query.mockResolvedValueOnce([{ active_method: 'fifo', active_epoch_id: 2 }])
      .mockResolvedValueOnce([{ variant_id: 'v1', cost: '7', soh: '3', total_value: '21', layer_quantity: '3' }])
      .mockResolvedValueOnce([]);
    const body = await (await GET(request(query))).json();
    expect(body).toMatchObject({ historical: false, costing_method: 'fifo', data: [{ total_value: 21 }], reconciliation: { status: 'balanced' } });
    expect(mocks.query.mock.calls[1][0]).toContain('SUM(remaining_quantity * unit_cost)');
    expect(mocks.query.mock.calls[2][0]).toContain('GROUP BY position.variant_id, position.location_id');
    expect(mocks.historical).not.toHaveBeenCalled();
  });
  it('calls historical reconstruction only for past dates with the local end-of-day cutoff and tenant filters', async () => {
    mocks.historical.mockResolvedValue({ data: [], costing_method: 'average_cost' });
    const body = await (await GET(request('?asAt=2026-10-04&brand=Acme&supplierId=4&productId=v1&productType=Apparel'))).json();
    expect(body).toMatchObject({ as_at: '2026-10-04', historical: true, time_zone: 'Australia/Sydney' });
    expect(mocks.historical).toHaveBeenCalledWith('tenant-1', '2026-10-04 13:00:00.000', {
      brand: 'Acme', supplierId: '4', productId: 'v1', productType: 'Apparel', ownership: 'owned',
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each(['2026-02-30', '2026-10-15', '', '2026-1-01'])('rejects invalid/future dates without loading valuation or reporting runtime failures: %s', async date => {
    expect((await GET(request(`?asAt=${date}`))).status).toBe(400);
    expect(mocks.historical).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated access before resolving the timezone', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.timeZone).not.toHaveBeenCalled();
  });
  it('records historical operational failures visibly', async () => {
    mocks.historical.mockRejectedValue(new Error('Stock history unavailable'));
    const response = await GET(request('?asAt=2026-10-01'));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, error: 'Stock history unavailable' });
    expect(mocks.issue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'tenant-1', source: 'ims_inventory_valuation',
      context: expect.objectContaining({ asAt: '2026-10-01' }),
    }));
  });
});
