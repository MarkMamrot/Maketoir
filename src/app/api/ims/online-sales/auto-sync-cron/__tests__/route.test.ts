import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockQuery,
  mockImsQuery,
  mockSyncOnlineDailySalesDay,
  mockRunImsForBusiness,
  mockGetBusinessTimeZone,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockImsQuery: vi.fn(),
  mockSyncOnlineDailySalesDay: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
  mockGetBusinessTimeZone: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({
  query: mockQuery,
}));

vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mockImsQuery,
}));

vi.mock('@/lib/xero/onlineDailySalesSync', () => ({
  syncOnlineDailySalesDay: mockSyncOnlineDailySalesDay,
}));

vi.mock('@/lib/db/BusinessRegistry', () => ({
  runImsForBusiness: mockRunImsForBusiness,
}));

vi.mock('@/lib/ims/businessTimeZone', () => ({
  getBusinessTimeZone: mockGetBusinessTimeZone,
}));

import { POST } from '../route';

function cronRequest(secret?: string): Request {
  return new Request('http://localhost/api/ims/online-sales/auto-sync-cron', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  });
}

function setupDefaultMocks() {
  process.env.CRON_SECRET = 'cron-secret';
  process.env.BUSINESS_TIMEZONE = 'Australia/Sydney';
  mockRunImsForBusiness.mockImplementation(async (_businessId: string, callback: () => Promise<void>) => callback());
  mockGetBusinessTimeZone.mockResolvedValue('Australia/Sydney');
  mockQuery.mockImplementation(async (sql: string) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.includes('from businesses where deleted_at is null')) {
      expect(normalized).toContain('coalesce(automation_paused, 0) = 0');
      return [{ business_id: 'biz-1' }];
    }

    if (normalized.includes('from xero_sync_log')) {
      return [];
    }

    throw new Error(`Unhandled SQL in query mock: ${sql}`);
  });
}

function makeImsQueryForDay() {
  mockImsQuery.mockImplementation(async (sql: string) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.includes("from ims_settings where business_id = ? and `key` = 'shopify_xero_auto_sync_enabled'")) {
      return [];
    }

    if (normalized.includes('select count(*) as c from ims_sales_orders')) {
      return [{ c: 1 }];
    }

    if (normalized.includes('group by date_format(order_date')) {
      return [{ day: '2026-07-24' }];
    }

    throw new Error(`Unhandled SQL in imsQuery mock: ${sql}`);
  });
}

describe('POST /api/ims/online-sales/auto-sync-cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
    mockSyncOnlineDailySalesDay.mockResolvedValue({
      xeroId: 'xero-1', totalSales: 55, totalTax: 5, giftCardAmount: 0, orderCount: 1,
    });
  });

  it('rejects requests without the shared cron secret', async () => {
    const res = await POST(cronRequest());
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('Unauthorised');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockImsQuery).not.toHaveBeenCalled();
  });

  it('uses one combined invoice even when gateway mappings exist', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalized.includes('from businesses where deleted_at is null')) {
        expect(normalized).toContain('coalesce(automation_paused, 0) = 0');
        return [{ business_id: 'biz-1' }];
      }

      if (normalized.includes('from xero_gateway_mappings')) {
        return [{ gateway_name: 'paypal', clearing_account_code: '777' }];
      }

      if (normalized.includes('from xero_sync_log')) {
        return [];
      }

      throw new Error(`Unhandled SQL in query mock: ${sql}`);
    });
    makeImsQueryForDay();

    const res = await POST(cronRequest('cron-secret'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.synced).toBe(1);
    expect(mockRunImsForBusiness).toHaveBeenCalledWith('biz-1', expect.any(Function));
    expect(mockSyncOnlineDailySalesDay).toHaveBeenCalledWith('biz-1', '2026-07-24');
  });

  it('creates one combined invoice when no gateway mappings exist', async () => {
    makeImsQueryForDay();

    const res = await POST(cronRequest('cron-secret'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.synced).toBe(1);
    expect(mockSyncOnlineDailySalesDay).toHaveBeenCalledWith('biz-1', '2026-07-24');
  });

  it('defers Shopify Payments while paying other gateways on the combined invoice', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.includes('from businesses where deleted_at is null')) {
        expect(normalized).toContain('coalesce(automation_paused, 0) = 0');
        return [{ business_id: 'biz-1' }];
      }
      if (normalized.includes('from xero_sync_log')) return [];
      throw new Error(`Unhandled SQL in query mock: ${sql}`);
    });
    mockImsQuery.mockImplementation(async (sql: string) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.includes('from ims_settings')) {
        return [];
      }
      if (normalized.includes('select count(*) as c from ims_sales_orders')) return [{ c: 2 }];
      if (normalized.includes('group by date_format(order_date')) return [{ day: '2026-07-24' }];
      throw new Error(`Unhandled SQL in imsQuery mock: ${sql}`);
    });

    const res = await POST(cronRequest('cron-secret'));

    expect(res.status).toBe(200);
    expect(mockSyncOnlineDailySalesDay).toHaveBeenCalledWith('biz-1', '2026-07-24');
  });
});
