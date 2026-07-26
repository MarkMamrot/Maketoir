import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockQuery,
  mockImsQuery,
  mockImsExecute,
  mockSyncDailySalesBatch,
  mockSyncGiftCardLiabilityReclass,
  mockRunImsForBusiness,
  mockGetBusinessTimeZone,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
  mockSyncDailySalesBatch: vi.fn(),
  mockSyncGiftCardLiabilityReclass: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
  mockGetBusinessTimeZone: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({
  query: mockQuery,
}));

vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mockImsQuery,
  imsExecute: mockImsExecute,
}));

vi.mock('@/services/XeroSyncService', () => ({
  syncDailySalesBatch: mockSyncDailySalesBatch,
  syncGiftCardLiabilityReclass: mockSyncGiftCardLiabilityReclass,
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
  mockImsExecute.mockResolvedValue({});
  mockQuery.mockImplementation(async (sql: string) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.includes('from businesses where deleted_at is null')) {
      return [{ business_id: 'biz-1' }];
    }

    if (normalized.includes('from xero_gateway_mappings')) {
      return [];
    }

    if (normalized.includes('from xero_sync_log')) {
      return [];
    }

    throw new Error(`Unhandled SQL in query mock: ${sql}`);
  });
}

function makeImsQueryForLegacy() {
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

    if (normalized.includes('select coalesce(sum(total_amount), 0) as ts')) {
      return [{ ts: '55.00', tt: '5.00', tc: '1' }];
    }

    if (normalized.includes("group by coalesce(lower(trim(payment_gateway)), '_unknown')")) {
      return [{ gateway: 'paypal', ts: '55.00', tt: '5.00' }];
    }

    throw new Error(`Unhandled SQL in imsQuery mock: ${sql}`);
  });
}

describe('POST /api/ims/online-sales/auto-sync-cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
    mockSyncDailySalesBatch.mockResolvedValue('xero-1');
    mockSyncGiftCardLiabilityReclass.mockResolvedValue('journal-1');
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
    makeImsQueryForLegacy();

    const res = await POST(cronRequest('cron-secret'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.synced).toBe(1);
    expect(mockRunImsForBusiness).toHaveBeenCalledWith('biz-1', expect.any(Function));
    expect(mockSyncDailySalesBatch).toHaveBeenCalledWith('biz-1', expect.objectContaining({
      date: '2026-07-24',
      channel: 'online',
      totalSales: 55,
      totalTax: 5,
      lineDescription: 'Online Sales 2026-07-24 (1 orders)',
      clearingPayments: [{ accountCode: '777', amount: 60, label: 'paypal' }],
    }));
    expect(mockSyncDailySalesBatch.mock.calls[0][1]).not.toHaveProperty('gateway');
  });

  it('creates one combined invoice when no gateway mappings exist', async () => {
    makeImsQueryForLegacy();

    const res = await POST(cronRequest('cron-secret'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.synced).toBe(1);
    expect(mockSyncDailySalesBatch).toHaveBeenCalledWith('biz-1', expect.objectContaining({
      date: '2026-07-24',
      channel: 'online',
      totalSales: 55,
      totalTax: 5,
      lineDescription: 'Online Sales 2026-07-24 (1 orders)',
    }));
    expect(mockSyncDailySalesBatch.mock.calls[0][1]).not.toHaveProperty('gateway');
    expect(mockSyncDailySalesBatch.mock.calls[0][1]).not.toHaveProperty('clearingAccountCode');
  });

  it('defers Shopify Payments while paying other gateways on the combined invoice', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.includes('from businesses where deleted_at is null')) return [{ business_id: 'biz-1' }];
      if (normalized.includes('from xero_gateway_mappings')) {
        return [
          { gateway_name: 'shopify_payments', clearing_account_code: '091' },
          { gateway_name: 'paypal', clearing_account_code: '092' },
        ];
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
      if (normalized.includes('coalesce(sum(gift_card_amount)')) {
        return [{ ts: '150.00', tt: '15.00', gca: '0', tc: '2' }];
      }
      if (normalized.includes("group by coalesce(lower(trim(payment_gateway)), '_unknown')")) {
        return [
          { gateway: 'shopify payments', ts: '100.00', tt: '10.00' },
          { gateway: 'paypal express', ts: '50.00', tt: '5.00' },
        ];
      }
      throw new Error(`Unhandled SQL in imsQuery mock: ${sql}`);
    });

    const res = await POST(cronRequest('cron-secret'));

    expect(res.status).toBe(200);
    expect(mockSyncDailySalesBatch).toHaveBeenCalledWith('biz-1', expect.objectContaining({
      payoutManaged: true,
      clearingPayments: [{ accountCode: '092', amount: 55, label: 'paypal_express' }],
      gatewayAllocations: [
        { gateway: 'shopify_payments', amount: 110, payoutManaged: true },
        { gateway: 'paypal_express', amount: 55, payoutManaged: false },
      ],
    }));
  });
});
