import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionsRow } from '@/lib/db/ConnectionsRepository';
const { mockRunIms, mockImsQuery, mockImsExecute, mockConnectionGet } = vi.hoisted(() => ({
  mockRunIms: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
  mockConnectionGet: vi.fn(),
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunIms }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery, imsExecute: mockImsExecute }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mockConnectionGet } }));
import {
  integrationAvailabilitySettingKey,
  isOptionalIntegrationConfigured,
  isOptionalIntegrationProvider,
  OPTIONAL_INTEGRATION_PROVIDERS,
  preserveDisabledDefaultBeforeCredentialSave,
  resolveIntegrationAvailability,
} from '../integrationAvailability';

function connection(overrides: Partial<ConnectionsRow> = {}): ConnectionsRow {
  return {
    business_id: 'business-1',
    cin7_account_id: null,
    cin7_api_key: null,
    shopify_shop_id: null,
    shopify_auth_mode: null,
    shopify_access_token: null,
    shopify_client_id: null,
    shopify_client_secret: null,
    shopify_token_expires_at: null,
    meta_ad_account_id: null,
    meta_access_token: null,
    google_ads_customer_id: null,
    google_ads_refresh_token: null,
    klaviyo_api_key: null,
    gmail_email: null,
    gmail_refresh_token: null,
    gmail_client_id: null,
    gmail_client_secret: null,
    website_sheet_id: null,
    inventory_sheet_id: null,
    gemini_model: null,
    ai_document_extraction_model: null,
    ai_catalogue_matching_model: null,
    ai_business_intelligence_model: null,
    ai_customer_service_model: null,
    ga4_property_id: null,
    xero_tenant_id: null,
    xero_tenant_name: null,
    xero_access_token: null,
    xero_refresh_token: null,
    xero_token_expiry: null,
    updated_at: '',
    ...overrides,
  };
}

describe('optional integration availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunIms.mockImplementation(async (_businessId: string, callback: () => unknown) => callback());
    mockImsQuery.mockResolvedValue([]);
    mockConnectionGet.mockResolvedValue(null);
  });

  it('creates an explicit off flag for a first-time unconfigured provider credential save', async () => {
    await preserveDisabledDefaultBeforeCredentialSave('business-1', 'cin7');

    expect(mockImsExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT IGNORE INTO ims_settings'),
      ['business-1', 'integration_cin7_enabled', '0'],
    );
  });

  it('preserves existing explicit flags and legacy configured providers', async () => {
    mockImsQuery.mockResolvedValueOnce([{ value: '1' }]);
    await preserveDisabledDefaultBeforeCredentialSave('business-1', 'gmail');
    expect(mockImsExecute).not.toHaveBeenCalled();

    mockImsQuery.mockResolvedValueOnce([]);
    mockConnectionGet.mockResolvedValueOnce(connection({ gmail_refresh_token: 'saved-token' }));
    await preserveDisabledDefaultBeforeCredentialSave('business-1', 'gmail');
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('exposes only the five new optional provider identifiers', () => {
    expect(OPTIONAL_INTEGRATION_PROVIDERS).toEqual(['cin7', 'google', 'meta', 'klaviyo', 'gmail']);
    expect(isOptionalIntegrationProvider('google')).toBe(true);
    expect(isOptionalIntegrationProvider('shopify')).toBe(false);
    expect(integrationAvailabilitySettingKey('google')).toBe('integration_google_enabled');
  });

  it('preserves configured providers when their new flag is missing', () => {
    const legacy = [
      ['cin7', connection({ cin7_account_id: 'acc', cin7_api_key: 'expired-or-encrypted' })],
      ['google', connection({ google_ads_refresh_token: 'expired-or-encrypted' })],
      ['meta', connection({ meta_ad_account_id: '123', meta_access_token: 'expired-or-encrypted' })],
      ['klaviyo', connection({ klaviyo_api_key: 'saved-key' })],
      ['gmail', connection({ gmail_refresh_token: 'expired-or-encrypted' })],
    ] as const;

    for (const [provider, row] of legacy) {
      expect(isOptionalIntegrationConfigured(provider, row)).toBe(true);
      expect(resolveIntegrationAvailability(provider, null, true)).toMatchObject({
        enabled: true,
        configured: true,
        status: 'configured',
      });
    }
  });

  it('defaults unconfigured providers off while allowing an explicit enable before setup', () => {
    expect(resolveIntegrationAvailability('cin7', null, false)).toMatchObject({
      enabled: false,
      configured: false,
      status: 'not_configured',
    });
    expect(resolveIntegrationAvailability('cin7', '1', false).enabled).toBe(true);
  });

  it('gives explicit off precedence over legacy credentials without clearing them', () => {
    const row = connection({ gmail_email: 'shop@example.com', gmail_refresh_token: 'saved-token' });
    expect(isOptionalIntegrationConfigured('gmail', row)).toBe(true);
    expect(resolveIntegrationAvailability('gmail', '0', true)).toMatchObject({
      enabled: false,
      configured: true,
      status: 'configured',
    });
    expect(row.gmail_refresh_token).toBe('saved-token');
  });

  it('does not treat whitespace-only saved fields as configuration', () => {
    expect(isOptionalIntegrationConfigured('cin7', connection({ cin7_account_id: '  ', cin7_api_key: '' }))).toBe(false);
  });
});
