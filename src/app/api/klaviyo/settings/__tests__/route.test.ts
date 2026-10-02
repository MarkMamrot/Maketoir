import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdminTier: vi.fn(),
  assertBusinessAccess: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  getConnection: vi.fn(),
  reportRuntimeIssue: vi.fn(),
  runImsForBusiness: vi.fn(),
  isTenantReady: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminTier: mocks.requireAdminTier,
  assertBusinessAccess: mocks.assertBusinessAccess,
}));
vi.mock('@/lib/klaviyo/settingsRepository', () => ({
  KlaviyoSettingsRepository: { get: mocks.getSettings, save: mocks.saveSettings },
}));
vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: { get: mocks.getConnection },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/lib/klaviyo/schemaReadiness', () => ({ isKlaviyoTenantSchemaReady: mocks.isTenantReady }));

import { GET, PUT } from '../route';

const settings = {
  enabled: false,
  profilesEnabled: false,
  reportingEnabled: false,
  sources: { pos: false, nativeShop: false, wholesale: false, shopify: false },
  shopifyDuplicateRiskAcknowledged: false,
};

describe('/api/klaviyo/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminTier.mockReturnValue({ user: { businessId: 'business-1', tier: 'Admin' } });
    mocks.assertBusinessAccess.mockReturnValue(null);
    mocks.getSettings.mockResolvedValue(settings);
    mocks.getConnection.mockResolvedValue({ klaviyo_api_key: 'encrypted-key' });
    mocks.reportRuntimeIssue.mockResolvedValue(null);
    mocks.isTenantReady.mockResolvedValue(true);
    mocks.runImsForBusiness.mockImplementation(async (_businessId: string, callback: () => Promise<unknown>) => callback());
  });

  it('rejects users without Admin access', async () => {
    mocks.requireAdminTier.mockReturnValue({ response: new Response(null, { status: 403 }) });

    const response = await GET(new Request('http://localhost/api/klaviyo/settings?databaseId=business-1'));

    expect(response.status).toBe(403);
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it('enforces selected-business ownership', async () => {
    mocks.assertBusinessAccess.mockReturnValue(new Response(null, { status: 403 }));

    const response = await GET(new Request('http://localhost/api/klaviyo/settings?databaseId=business-2'));

    expect(response.status).toBe(403);
    expect(mocks.assertBusinessAccess).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1' }), 'business-2');
  });

  it('returns fail-closed settings for the selected business', async () => {
    const response = await GET(new Request('http://localhost/api/klaviyo/settings?databaseId=business-1'));

    await expect(response.json()).resolves.toEqual({ success: true, settings, tenantReady: true });
    expect(mocks.getSettings).toHaveBeenCalledWith('business-1');
  });

  it('prevents activation when the selected tenant schema is not ready', async () => {
    mocks.isTenantReady.mockResolvedValue(false);
    const response = await PUT(new Request('http://localhost/api/klaviyo/settings', {
      method: 'PUT',
      body: JSON.stringify({ databaseId: 'business-1', settings: { ...settings, enabled: true } }),
    }));

    expect(response.status).toBe(409);
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('requires a saved API key before enabling', async () => {
    mocks.getConnection.mockResolvedValue(null);
    const response = await PUT(new Request('http://localhost/api/klaviyo/settings', {
      method: 'PUT',
      body: JSON.stringify({ databaseId: 'business-1', settings: { ...settings, enabled: true } }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('requires profile sync for enabled commerce sources', async () => {
    const response = await PUT(new Request('http://localhost/api/klaviyo/settings', {
      method: 'PUT',
      body: JSON.stringify({ databaseId: 'business-1', settings: { ...settings, enabled: true, sources: { ...settings.sources, pos: true } } }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('coerces omitted values off and saves valid settings', async () => {
    const response = await PUT(new Request('http://localhost/api/klaviyo/settings', {
      method: 'PUT',
      body: JSON.stringify({ databaseId: 'business-1', settings: { enabled: true, profilesEnabled: true, sources: { pos: true } } }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.saveSettings).toHaveBeenCalledWith('business-1', {
      enabled: true,
      profilesEnabled: true,
      reportingEnabled: false,
      sources: { pos: true, nativeShop: false, wholesale: false, shopify: false },
      shopifyDuplicateRiskAcknowledged: false,
    });
  });

  it('returns Shopify acknowledgement failures as validation errors', async () => {
    mocks.saveSettings.mockRejectedValue(new Error('Shopify Klaviyo events require acknowledgement of duplicate-event risk.'));
    const response = await PUT(new Request('http://localhost/api/klaviyo/settings', {
      method: 'PUT',
      body: JSON.stringify({ databaseId: 'business-1', settings: { ...settings, enabled: true, sources: { ...settings.sources, shopify: true } } }),
    }));

    expect(response.status).toBe(400);
  });

  it('reports database failures without exposing their details', async () => {
    mocks.getSettings.mockRejectedValue(new Error('Table does not exist'));

    const response = await GET(new Request('http://localhost/api/klaviyo/settings?databaseId=business-1'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Unable to load Klaviyo settings.' });
    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', operation: 'load' }));
  });
});