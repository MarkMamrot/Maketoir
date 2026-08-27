import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getImsSession: vi.fn(),
  imsQuery: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: vi.fn() }));
vi.mock('@/services/XeroSyncService', () => ({ syncGiftCardIssueInvoice: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET } from '../route';

describe('gift-card list route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImsSession.mockResolvedValue({ businessId: 'business-1', tier: 'Manager' });
    mocks.imsQuery
      .mockResolvedValueOnce([{ id: 1, code: 'SHOPIFY:7215' }])
      .mockResolvedValueOnce([{ total: 1 }]);
  });

  it('joins Shopify customer identifiers with an explicit shared collation', async () => {
    const response = await GET(new Request('https://solvantis.com.au/api/ims/gift-cards?limit=100&offset=0'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, total: 1 });
    expect(mocks.imsQuery).toHaveBeenCalledTimes(2);
    for (const [sql] of mocks.imsQuery.mock.calls) {
      expect(sql).toContain(
        'contact.shopify_customer_id COLLATE utf8mb4_general_ci = gc.customer_id COLLATE utf8mb4_general_ci',
      );
    }
  });
});