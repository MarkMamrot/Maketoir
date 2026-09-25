import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getImsSession: vi.fn(),
  imsQuery: vi.fn(),
  mainQuery: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.mainQuery }));
vi.mock('@/services/XeroSyncService', () => ({ syncGiftCardIssueInvoice: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET } from '../route';

describe('gift-card list route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImsSession.mockResolvedValue({ businessId: 'business-1', tier: 'Manager' });
    mocks.imsQuery
      .mockResolvedValueOnce([{ id: 1, code: 'SHOPIFY:7215', channel_instance_id: 'store-1' }])
      .mockResolvedValueOnce([{ total: 1 }]);
    mocks.mainQuery.mockResolvedValue([{ channel_instance_id: 'store-1', display_name: 'Monsterthreads', external_account_key: 'monsterthreads.myshopify.com' }]);
  });

  it('joins exact customer mappings and returns the owning channel display name', async () => {
    const response = await GET(new Request('https://solvantis.com.au/api/ims/gift-cards?channelInstanceId=store-1&contact_id=42&limit=100&offset=0'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      total: 1,
      data: [{ channel_instance_id: 'store-1', channel_display_name: 'Monsterthreads' }],
      channels: [{ channelInstanceId: 'store-1', displayName: 'Monsterthreads' }],
    });
    expect(mocks.imsQuery).toHaveBeenCalledTimes(2);
    for (const [sql] of mocks.imsQuery.mock.calls) {
      expect(sql).toContain('mapping.channel_instance_id = gc.channel_instance_id');
      expect(sql).toContain('mapping.external_customer_id COLLATE utf8mb4_general_ci = gc.customer_id COLLATE utf8mb4_general_ci');
      expect(sql).toContain('gc.channel_instance_id = ?');
      expect(sql).toContain('contact.id = ?');
    }
  });
});