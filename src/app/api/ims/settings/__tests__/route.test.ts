import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetImsSession, mockImsQuery, mockImsExecute, mockGetConnection, mockGetCapabilities, mockSetCapabilities } = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
  mockGetConnection: vi.fn(),
  mockGetCapabilities: vi.fn(),
  mockSetCapabilities: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery, imsExecute: mockImsExecute }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: { get: mockGetConnection },
}));
vi.mock('@/lib/onlineShop/onlineShopProfile', () => ({
  OnlineSalesChannelRepository: { getCapabilities: mockGetCapabilities, setCapabilities: mockSetCapabilities },
}));

import { GET, PUT } from '../route';
import { FEATURE_TOGGLE_KEYS } from '@/lib/ims/featureToggles';
import { CONSIGNMENT_TRACKING_KEY } from '@/lib/ims/consignment/domain';

function putRequest(settings: Record<string, string>): Request {
  return new Request('http://localhost/api/ims/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
}

function putOnlineChannels(shopifyEnabled: boolean, nativeShopEnabled: boolean): Request {
  return new Request('http://localhost/api/ims/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ onlineChannels: { shopifyEnabled, nativeShopEnabled } }),
  });
}

const invalidFeatureToggleUpdates: Record<string, string>[] = [
  { feature_toggle_crm: 'false' }, { feature_toggle_unknown: 'yes' },
  { feature_toggle_crm: '' }, { FEATURE_TOGGLE_CRM: 'no' },
];

describe('/api/ims/settings loyalty settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1' });
    mockImsQuery.mockResolvedValue([]);
    mockImsExecute.mockResolvedValue({ affectedRows: 1 });
    mockGetConnection.mockResolvedValue(null);
    mockGetCapabilities.mockResolvedValue({ shopifyEnabled: false, nativeShopEnabled: false });
    mockSetCapabilities.mockResolvedValue(undefined);
  });

  it('returns loyalty switched off when the tenant has no loyalty settings', async () => {
    const response = await GET();
    const body = await response.json();

    expect(body.success).toBe(true);
    for (const key of FEATURE_TOGGLE_KEYS) {
      expect(body.data[key]).toBe(key === CONSIGNMENT_TRACKING_KEY ? 'no' : 'yes');
    }
    expect(body.data[CONSIGNMENT_TRACKING_KEY]).toBe('no');
    expect(body.data.advisor_xero_sync_enabled).toBe('false');
    expect(body.data).toMatchObject({
      business_requires_pos: 'yes',
      loyalty_enabled: '0',
      loyalty_earn_rate: '1',
      loyalty_program_name: 'Rewards Program',
      loyalty_points_label: 'Points',
      loyalty_started_at: '',
      sales_document_show_logo: '1',
      sales_tax_on_sales: 'yes',
      sales_tax_rate: '0.1',
      sales_tax_code: 'GST',
      purchase_tax_rate: '0.1',
      purchase_tax_code: 'GST on Purchases',
    });
    expect(body.capabilities).toEqual({
      hasPosLocations: false,
      xeroAccountingEnabled: false,
      shopifyEnabled: false,
      nativeShopEnabled: false,
    });
  });

  it.each(['Advisor', 'StandardUser', 'PosManager', 'PosUser'])('prevents %s from changing feature switches', async tier => {
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1', tier });
    expect((await PUT(putRequest({ feature_toggle_crm: 'no', business_name: 'Unchanged' }))).status).toBe(403);
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it.each(['Admin', 'SuperAdmin'])('allows %s to save presentation feature switches, excluding operational tracking', async tier => {
    mockGetImsSession.mockResolvedValue({ businessId: 'business-2', tier });
    const presentationKeys = FEATURE_TOGGLE_KEYS.filter(key => key !== CONSIGNMENT_TRACKING_KEY);
    const settings = Object.fromEntries(presentationKeys.map(key => [key, 'no']));
    expect((await PUT(putRequest(settings))).status).toBe(200);
    for (const key of presentationKeys) expect(mockImsExecute).toHaveBeenCalledWith(expect.any(String), ['business-2', key, 'no']);
    expect(mockImsExecute).not.toHaveBeenCalledWith(expect.any(String), ['business-2', CONSIGNMENT_TRACKING_KEY, 'no']);
  });

  it.each(['Admin', 'SuperAdmin'])('requires %s to use the dedicated cutover/handover endpoint for consignment tracking', async tier => {
    mockGetImsSession.mockResolvedValue({ businessId: 'business-2', tier });
    for (const value of ['yes', 'no']) {
      const response = await PUT(putRequest({ [CONSIGNMENT_TRACKING_KEY]: value, business_name: 'Must not partially save' }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('consignment tracking transition endpoint');
    }
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('returns the persisted operational tracking setting without changing other defaults', async () => {
    mockImsQuery.mockResolvedValueOnce([{ key: CONSIGNMENT_TRACKING_KEY, value: 'yes' }]);
    const body = await (await GET()).json();
    expect(body.data[CONSIGNMENT_TRACKING_KEY]).toBe('yes');
    expect(body.data.feature_toggle_crm).toBe('yes');
    expect(mockImsExecute).not.toHaveBeenCalled();
  });
  it.each(invalidFeatureToggleUpdates)('rejects invalid or unknown switches before writing: %j', async settings => {
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    expect((await PUT(putRequest(settings))).status).toBe(400);
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('returns saved switches only for the selected tenant', async () => {
    mockGetImsSession.mockResolvedValue({ businessId: 'business-2', tier: 'Admin' });
    mockImsQuery.mockResolvedValueOnce([{ key: 'feature_toggle_crm', value: 'no' }]);
    const body = await (await GET()).json();
    expect(body.data.feature_toggle_crm).toBe('no');
    expect(mockImsQuery).toHaveBeenCalledWith(expect.stringContaining('FROM ims_settings WHERE business_id = ?'), ['business-2']);
  });

  it.each(['Advisor', 'StandardUser'])('prevents %s from granting Advisor sync access', async tier => {
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1', tier });
    expect((await PUT(putRequest({ advisor_xero_sync_enabled: 'true' }))).status).toBe(403);
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('allows an administrator to enable Advisor sync access', async () => {
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    expect((await PUT(putRequest({ advisor_xero_sync_enabled: 'true' }))).status).toBe(200);
    expect(mockImsExecute).toHaveBeenCalledWith(expect.any(String), ['business-1', 'advisor_xero_sync_enabled', 'true']);
  });

  it('reports existing POS location evidence separately from editable settings', async () => {
    mockImsQuery.mockImplementation((sql: string) => Promise.resolve(
      sql.includes('SELECT EXISTS') ? [{ has_pos_locations: 1 }] : [],
    ));

    const response = await GET();
    const body = await response.json();

    expect(body.capabilities).toEqual({
      hasPosLocations: true,
      xeroAccountingEnabled: false,
      shopifyEnabled: false,
      nativeShopEnabled: false,
    });
    expect(body.data).not.toHaveProperty('has_pos_locations');
  });

  it('preserves configured tax settings when Xero accounting is switched off', async () => {
    mockImsQuery.mockImplementation((sql: string) => Promise.resolve(
      sql.includes('SELECT EXISTS')
        ? [{ has_pos_locations: 0 }]
        : [
            { key: 'connect_accounting_software', value: 'no' },
            { key: 'sales_tax_on_sales', value: 'no' },
            { key: 'sales_tax_rate', value: '0.15' },
            { key: 'sales_tax_code', value: 'Custom sales label' },
            { key: 'purchase_tax_rate', value: '0.125' },
            { key: 'purchase_tax_code', value: 'Custom purchase label' },
          ],
    ));

    const response = await GET();
    const body = await response.json();

    expect(body.capabilities.xeroAccountingEnabled).toBe(false);
    expect(body.data).toMatchObject({
      sales_tax_on_sales: 'no',
      sales_tax_rate: '0.15',
      sales_tax_code: 'Custom sales label',
      purchase_tax_rate: '0.125',
      purchase_tax_code: 'Custom purchase label',
    });
  });

  it('reports Xero accounting only when both operation settings enable it', async () => {
    mockImsQuery.mockImplementation((sql: string) => Promise.resolve(
      sql.includes('SELECT EXISTS')
        ? [{ has_pos_locations: 0 }]
        : [
            { key: 'connect_accounting_software', value: 'yes' },
            { key: 'accounting_software', value: 'xero' },
          ],
    ));

    const response = await GET();
    const body = await response.json();

    expect(body.capabilities.xeroAccountingEnabled).toBe(true);
  });

  it('returns both online channel capabilities and hides a disabled Shopify domain', async () => {
    mockGetCapabilities.mockResolvedValue({ shopifyEnabled: false, nativeShopEnabled: true });
    mockGetConnection.mockResolvedValue({ shopify_shop_id: 'hidden.myshopify.com' });

    const response = await GET();
    const body = await response.json();

    expect(body.capabilities).toMatchObject({ shopifyEnabled: false, nativeShopEnabled: true });
    expect(body.shopDomain).toBe('');
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it('persists both online channel capabilities independently', async () => {
    const response = await PUT(putOnlineChannels(true, true));

    expect(response.status).toBe(200);
    expect(mockSetCapabilities).toHaveBeenCalledWith({
      businessId: 'business-1',
      shopifyEnabled: true,
      nativeShopEnabled: true,
      actorUserId: null,
      actorName: null,
    });
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('validates sales document settings before writing', async () => {
    const response = await PUT(putRequest({ sales_document_bank_bsb: '1234' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('exactly 6 digits');
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('rejects invalid POS requirement settings before writing', async () => {
    const response = await PUT(putRequest({ business_requires_pos: 'sometimes' }));
    expect(response.status).toBe(400);
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('rejects deprecated global Shopify operational settings', async () => {
    const response = await PUT(putRequest({ shopify_inventory_buffer: '5' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('selected store in Sales Channels');
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('accepts curated Website AI models and rejects retired model IDs', async () => {
    const retiredResponse = await PUT(putRequest({ ai_website_content_model: 'gemini-2.5-flash' }));
    expect(retiredResponse.status).toBe(400);
    expect(mockImsExecute).not.toHaveBeenCalled();

    const curatedResponse = await PUT(putRequest({ ai_website_content_model: 'gemini-3.7-flash' }));
    expect(curatedResponse.status).toBe(200);
    expect(mockImsExecute).toHaveBeenCalledWith(expect.any(String), [
      'business-1',
      'ai_website_content_model',
      'gemini-3.7-flash',
    ]);
  });

  it.each([
    { connect_accounting_software: 'sometimes' },
    { accounting_software: 'quickbooks' },
  ])('rejects invalid accounting operation settings before writing: %o', async settings => {
    const response = await PUT(putRequest(settings));
    expect(response.status).toBe(400);
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('normalizes and persists sales document settings', async () => {
    const response = await PUT(putRequest({
      sales_document_show_logo: '1',
      sales_document_bank_account_name: '  Example Trading  ',
      sales_document_bank_bsb: '123-456',
      sales_document_bank_account_number: '1234 5678',
    }));

    expect(response.status).toBe(200);
    expect(mockImsExecute).toHaveBeenCalledTimes(4);
    expect(mockImsExecute.mock.calls[1][1]).toEqual([
      'business-1',
      'sales_document_bank_account_name',
      'Example Trading',
    ]);
  });

  it.each([
    [{ loyalty_enabled: 'yes' }, 'Loyalty enabled'],
    [{ loyalty_earn_rate: '0' }, 'Loyalty earn rate'],
    [{ loyalty_started_at: '2026-02-31' }, 'Loyalty start date'],
  ])('rejects invalid loyalty settings before writing: %o', async (settings, errorText) => {
    const response = await PUT(putRequest(settings));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain(errorText);
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('persists a valid disabled configuration without enabling loyalty', async () => {
    const response = await PUT(putRequest({
      loyalty_enabled: '0',
      loyalty_earn_rate: '1.5',
      loyalty_program_name: 'Club Rewards',
      loyalty_points_label: 'Stars',
      loyalty_started_at: '',
    }));

    expect(response.status).toBe(200);
    expect(mockImsExecute).toHaveBeenCalledTimes(5);
    expect(mockImsExecute.mock.calls[0][1]).toEqual(['business-1', 'loyalty_enabled', '0']);
  });

  it('returns safe wholesale portal defaults', async () => {
    const response = await GET();
    const body = await response.json();
    expect(body.data).toMatchObject({
      wholesale_staff_preview_mode: 'read_only',
      wholesale_product_image_fit: 'cover',
      wholesale_product_image_ratio: 'landscape',
      wholesale_order_quantity_mode: 'individual',
      wholesale_catalogue_order_view: 'quick_order',
    });
  });

  it('rejects invalid wholesale portal settings before writing', async () => {
    const response = await PUT(putRequest({ wholesale_staff_preview_mode: 'full_access' }));
    expect(response.status).toBe(400);
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('normalizes and persists valid wholesale portal settings', async () => {
    const response = await PUT(putRequest({
      wholesale_staff_preview_mode: ' IMS_DRAFT_TEST ',
      wholesale_product_image_fit: 'contain',
      wholesale_product_image_ratio: 'square',
      wholesale_order_quantity_mode: 'pack',
      wholesale_catalogue_order_view: 'storefront',
    }));
    expect(response.status).toBe(200);
    expect(mockImsExecute.mock.calls.map(call => call[1])).toEqual([
      ['business-1', 'wholesale_staff_preview_mode', 'ims_draft_test'],
      ['business-1', 'wholesale_product_image_fit', 'contain'],
      ['business-1', 'wholesale_product_image_ratio', 'square'],
      ['business-1', 'wholesale_order_quantity_mode', 'pack'],
      ['business-1', 'wholesale_catalogue_order_view', 'storefront'],
    ]);
  });
});