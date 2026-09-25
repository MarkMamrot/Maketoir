import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  list: vi.fn(),
  listPosLedger: vi.fn(),
  mainQuery: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsSORepo: {
    list: mocks.list,
    listPosLedger: mocks.listPosLedger,
    findSalesOrderIdsByProduct: vi.fn(),
    findPosSaleIdsByProduct: vi.fn(),
  },
}));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.mainQuery }));
vi.mock('@/lib/ims/earlyPaymentDiscountRules', () => ({ resolveEarlyPaymentDiscountOrderSnapshot: vi.fn() }));

import { GET } from '../route';

describe('sales-order list channel filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Manager' });
    mocks.list.mockResolvedValue([
      { id: 1, order_date: '2026-09-20', channel_instance_id: 'store-a' },
      { id: 2, order_date: '2026-09-21', channel_instance_id: 'store-b' },
    ]);
    mocks.listPosLedger.mockResolvedValue([{ id: 3, order_date: '2026-09-22', is_pos_ledger: true }]);
    mocks.mainQuery.mockResolvedValue([
      { channel_instance_id: 'store-a', display_name: 'Store A' },
      { channel_instance_id: 'store-b', display_name: 'Store B' },
    ]);
  });

  it('filters an exact storefront before pagination and excludes POS rows', async () => {
    const response = await GET(new Request('https://solvantis.com.au/api/ims/sales-orders?channel=all&channelInstanceId=store-a'));
    const body = await response.json();

    expect(mocks.list).toHaveBeenCalledWith(undefined, 'business-1', 'online');
    expect(mocks.listPosLedger).not.toHaveBeenCalled();
    expect(body).toMatchObject({ success: true, total: 1, data: [{ id: 1, channel_instance_id: 'store-a', channel_display_name: 'Store A' }] });
  });
});