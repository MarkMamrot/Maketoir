import { query, execute } from '@/services/MySQLService';

/**
 * Mirrors the 'connections' table columns exactly.
 * Snake_case matches the DB. The public API maps the
 * legacy camelCase keys used by the frontend.
 */
export interface ConnectionsRow {
  business_id:              string;
  cin7_account_id:          string | null;
  cin7_api_key:             string | null;
  shopify_shop_id:          string | null;
  shopify_access_token:     string | null;
  meta_ad_account_id:       string | null;
  meta_access_token:        string | null;
  google_ads_customer_id:   string | null;
  google_ads_refresh_token: string | null;
  klaviyo_api_key:          string | null;
  gmail_email:              string | null;
  gmail_refresh_token:      string | null;
  website_sheet_id:         string | null;
  inventory_sheet_id:       string | null;
  gemini_model:             string | null;
  ga4_property_id:          string | null;
  xero_tenant_id:           string | null;
  xero_tenant_name:         string | null;
  xero_access_token:        string | null;
  xero_refresh_token:       string | null;
  xero_token_expiry:        string | null;
  updated_at:               string;
}

type PartialConnections = Partial<Omit<ConnectionsRow, 'business_id' | 'updated_at'>>;

/**
 * Legacy camelCase → snake_case column map.
 * Mirrors the old Google Sheet HEADERS array.
 */
const LEGACY_MAP: Record<string, keyof PartialConnections> = {
  Cin7AccountId:           'cin7_account_id',
  Cin7ApiKey:              'cin7_api_key',
  ShopifyShopId:           'shopify_shop_id',
  ShopifyAccessToken:      'shopify_access_token',
  MetaAdAccountId:         'meta_ad_account_id',
  MetaAccessToken:         'meta_access_token',
  GoogleAdsCustomerId:     'google_ads_customer_id',
  GoogleAdsRefreshToken:   'google_ads_refresh_token',
  KlaviyoApiKey:           'klaviyo_api_key',
  GmailAddress:            'gmail_email',
  GmailRefreshToken:       'gmail_refresh_token',
  WebsiteSheetId:          'website_sheet_id',
  GA4PropertyId:           'ga4_property_id',
  GeminiModel:             'gemini_model',
  XeroTenantId:            'xero_tenant_id',
  XeroTenantName:          'xero_tenant_name',
  XeroTokenExpiry:         'xero_token_expiry',
};

/** Which legacy keys are secrets that must be encrypted/decrypted */
export const CONNECTION_SECRET_FIELDS = new Set([
  'ShopifyAccessToken',
  'MetaAccessToken',
  'Cin7ApiKey',
  'GmailRefreshToken',
  'KlaviyoApiKey',
  'GoogleAdsRefreshToken',
]);

/** Xero OAuth tokens stored directly (not via legacy map) — these are always encrypted */
export const XERO_TOKEN_FIELDS = ['xero_access_token', 'xero_refresh_token'] as const;

export const ConnectionsRepository = {
  async get(businessId: string): Promise<ConnectionsRow | null> {
    const rows = await query<ConnectionsRow>(
      'SELECT * FROM connections WHERE business_id = ?',
      [businessId],
    );
    return rows[0] ?? null;
  },

  /** Convert legacy camelCase connections object → snake_case upsert */
  async saveFromLegacy(
    businessId: string,
    legacyConnections: Record<string, string>,
  ): Promise<void> {
    const mapped: PartialConnections = {};
    for (const [legacyKey, val] of Object.entries(legacyConnections)) {
      const col = LEGACY_MAP[legacyKey];
      if (col) (mapped as any)[col] = val || null;
    }
    await ConnectionsRepository.upsert(businessId, mapped);
  },

  /** Returns a legacy-keyed object (for backward-compat with existing routes) */
  async getLegacy(businessId: string): Promise<Record<string, string>> {
    const row = await ConnectionsRepository.get(businessId);
    if (!row) return {};
    const result: Record<string, string> = {};
    for (const [legacyKey, col] of Object.entries(LEGACY_MAP)) {
      result[legacyKey] = (row as any)[col] ?? '';
    }
    return result;
  },

  async upsert(businessId: string, data: PartialConnections): Promise<void> {
    const fields = Object.keys(data) as (keyof PartialConnections)[];
    if (fields.length === 0) return;
    const setClauses = fields.map(f => `${f} = VALUES(${f})`).join(', ');
    const values = fields.map(f => (data as any)[f] ?? null);
    await execute(
      `INSERT INTO connections (business_id, ${fields.join(', ')})
       VALUES (?, ${fields.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${setClauses}, updated_at = NOW()`,
      [businessId, ...values],
    );
  },
};
