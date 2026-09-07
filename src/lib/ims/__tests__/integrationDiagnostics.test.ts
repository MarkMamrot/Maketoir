import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mainQuery: vi.fn(),
  imsQuery: vi.fn(),
  getConnection: vi.fn(),
  getCounts: vi.fn(),
  getLog: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ query: mocks.mainQuery }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: { get: mocks.getConnection },
}));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsShopifyRepo: { getCounts: mocks.getCounts, getLog: mocks.getLog },
}));

import {
  classifyIntegrationIssue,
  loadShopifyDiagnostics,
  loadXeroDiagnostics,
  sanitizeIntegrationSummary,
} from '../integrationDiagnostics';

describe('integration diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies common integration failures without returning raw Xero detail', async () => {
    mocks.getConnection.mockResolvedValueOnce({
      xero_tenant_id: 'tenant', xero_refresh_token: 'secret-refresh', xero_access_token: null,
    });
    mocks.imsQuery.mockResolvedValueOnce([{
      id: 8, reference: 'PO-8', source_type: 'purchase_order', source_status: 'complete', amount: '110',
    }]);
    mocks.mainQuery.mockResolvedValueOnce([{
      id: 50, sync_type: 'po_bill', reference_id: 8, status: 'error', xero_state: null,
      detail: 'Missing account mapping for purchases. token=never-return-this', created_at: '2026-09-05T01:00:00Z',
    }]);

    const result = await loadXeroDiagnostics({ businessId: 'biz-1', days: 30, limit: 10 });

    expect(mocks.imsQuery.mock.calls[0][1]).toEqual(['biz-1', 'biz-1', 'biz-1', 'biz-1']);
    expect(mocks.mainQuery.mock.calls[0][1]).toEqual(['biz-1', 30, 11]);
    expect(result).toMatchObject({
      connected: true,
      queued: [{ sourceId: 8, reference: 'PO-8', sourceType: 'purchase_order', amount: 110 }],
      recentFailures: [{ eventId: 50, syncType: 'po_bill', referenceId: 8, category: 'account_mapping' }],
    });
    expect(JSON.stringify(result)).not.toContain('never-return-this');
    expect(JSON.stringify(result)).not.toContain('secret-refresh');
  });

  it('returns bounded Shopify health while redacting sensitive summary text and raw detail', async () => {
    mocks.getConnection.mockResolvedValueOnce({
      shopify_auth_mode: 'legacy_token', shopify_shop_id: 'store.myshopify.com', shopify_access_token: 'secret-token',
    });
    mocks.getCounts.mockResolvedValueOnce({ linked: 9, notInShopify: 1, total: 10 });
    mocks.imsQuery.mockResolvedValueOnce([
      { key: 'shopify_order_sync_enabled', value: '1' },
      { key: 'shopify_webhook_secret', value: 'webhook-secret' },
    ]);
    mocks.getLog.mockResolvedValueOnce([{
      id: 4, action: 'sync_prices', status: 'error',
      summary: 'Unauthorized for admin@example.com at https://store.example/path token=abc123',
      detail: JSON.stringify({ accessToken: 'do-not-return' }), created_at: '2026-09-05T02:00:00Z',
    }]);

    const result = await loadShopifyDiagnostics({ businessId: 'biz-1', limit: 10 });

    expect(mocks.getCounts).toHaveBeenCalledWith('biz-1');
    expect(mocks.getLog).toHaveBeenCalledWith(11, 'biz-1');
    expect(result).toMatchObject({
      connected: true,
      orderSyncEnabled: true,
      webhookSecretConfigured: true,
      catalogue: { linked: 9, notInShopify: 1, total: 10 },
      recentActivity: [{ category: 'authentication' }],
      webhookRegistrationChecked: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/abc123|do-not-return|admin@example\.com|store\.example/);
  });

  it('recognises safe issue categories and sanitises credential-like text', () => {
    expect(classifyIntegrationIssue('Too many requests from Shopify')).toBe('rate_limit');
    expect(classifyIntegrationIssue('Tax code GST is invalid')).toBe('tax_mapping');
    expect(sanitizeIntegrationSummary('API key: abc https://example.com user@example.com')).toBe(
      'API key=[redacted] [external URL] [email]',
    );
  });
});
