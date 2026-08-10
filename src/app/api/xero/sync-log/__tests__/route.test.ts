import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mainQuery: vi.fn(),
  imsQuery: vi.fn(),
  xeroFetch: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: () => ({ user: { businessId: 'biz-1', tier: 'Admin' }, response: null }),
  assertBusinessAccess: () => null,
}));
vi.mock('@/services/MySQLService', () => ({ query: mocks.mainQuery }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/services/XeroService', () => ({ xeroApiFetch: mocks.xeroFetch }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ getImsDbNameStrict: async () => 'tenant_db' }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: async () => 'Australia/Sydney' }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET } from '../route';

describe('GET /api/xero/sync-log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.imsQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_purchase_orders po')) {
        return [{
          id: 7,
          po_number: 'PO-7',
          total_amount: 110,
          order_date: '2026-08-09',
          is_historical: 0,
          xero_sync_status: 'synced',
          xero_synced_at: '2026-08-09T01:00:00.000Z',
          contact_name: 'Supplier',
        }];
      }
      return [];
    });
    mocks.mainQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SHOW COLUMNS FROM xero_sync_log LIKE 'xero_state'")) return [{ Field: 'xero_state' }];
      if (sql.includes("sync_type IN ('po_bill','po_bill_void')")) {
        return [{
          reference_id: 7,
          sync_type: 'po_bill',
          xero_id: 'xero-invoice-7',
          status: 'success',
          xero_state: 'DRAFT',
          detail: null,
          synced_at: '2026-08-09T01:00:00.000Z',
        }];
      }
      return [];
    });
    mocks.xeroFetch.mockResolvedValue({
      Invoices: [{ InvoiceID: 'xero-invoice-7', Status: 'AUTHORISED' }],
    });
    mocks.reportRuntimeIssue.mockResolvedValue(undefined);
  });

  it('does not contact Xero during an automatic bulk history load', async () => {
    const response = await GET(new Request('http://localhost/api/xero/sync-log?databaseId=biz-1&limit=2000'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.entries[0].last_xero_state).toBe('DRAFT');
    expect(mocks.xeroFetch).not.toHaveBeenCalled();
  });

  it('refreshes live state only when explicitly requested', async () => {
    const response = await GET(new Request('http://localhost/api/xero/sync-log?databaseId=biz-1&limit=2000&refreshLive=1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.xeroFetch).toHaveBeenCalledOnce();
    expect(body.entries[0].last_xero_state).toBe('AUTHORISED');
  });

  it('omits POS credit notes that have no individual Xero sync event', async () => {
    mocks.imsQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_credit_notes cn')) {
        return [{
          id: 12,
          cn_number: 'CN-00012',
          total_amount: 24.95,
          cn_date: '2026-08-09',
          source: 'pos',
          pos_sale_id: 44,
          xero_sync_status: null,
          xero_synced_at: null,
          contact_name: '',
        }];
      }
      return [];
    });

    const response = await GET(new Request('http://localhost/api/xero/sync-log?databaseId=biz-1&limit=2000'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.entries).toEqual([]);
  });

  it('keeps a POS credit note when it has an individual Xero sync event', async () => {
    mocks.imsQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_credit_notes cn')) {
        return [{
          id: 12,
          cn_number: 'CN-00012',
          total_amount: 24.95,
          cn_date: '2026-08-09',
          source: 'pos',
          pos_sale_id: 44,
          xero_sync_status: 'synced',
          xero_synced_at: '2026-08-09T01:00:00.000Z',
          contact_name: '',
        }];
      }
      return [];
    });
    mocks.mainQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SHOW COLUMNS FROM xero_sync_log LIKE 'xero_state'")) return [{ Field: 'xero_state' }];
      if (sql.includes("sync_type IN ('cn_credit_note','cn_credit_note_void')")) {
        return [{
          reference_id: 12,
          sync_type: 'cn_credit_note',
          xero_id: 'xero-cn-12',
          status: 'success',
          xero_state: 'AUTHORISED',
          detail: 'Customer credit note posted',
          synced_at: '2026-08-09T01:00:00.000Z',
        }];
      }
      return [];
    });

    const response = await GET(new Request('http://localhost/api/xero/sync-log?databaseId=biz-1&limit=2000'));
    const body = await response.json();

    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ reference: 'CN-00012', xero_id: 'xero-cn-12', last_sync_status: 'success' });
  });
});