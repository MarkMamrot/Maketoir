import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetImsSession, mockImsQuery, mockImsExecute, mockGetConnection } = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
  mockGetConnection: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery, imsExecute: mockImsExecute }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: { get: mockGetConnection },
}));

import { GET, PUT } from '../route';

function putRequest(settings: Record<string, string>): Request {
  return new Request('http://localhost/api/ims/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
}

describe('/api/ims/settings loyalty settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1' });
    mockImsQuery.mockResolvedValue([]);
    mockImsExecute.mockResolvedValue({ affectedRows: 1 });
    mockGetConnection.mockResolvedValue(null);
  });

  it('returns loyalty switched off when the tenant has no loyalty settings', async () => {
    const response = await GET();
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      business_requires_pos: 'yes',
      loyalty_enabled: '0',
      loyalty_earn_rate: '1',
      loyalty_program_name: 'Rewards Program',
      loyalty_points_label: 'Points',
      loyalty_started_at: '',
      sales_document_show_logo: '1',
    });
    expect(body.capabilities).toEqual({ hasPosLocations: false, xeroAccountingEnabled: false });
  });

  it('reports existing POS location evidence separately from editable settings', async () => {
    mockImsQuery.mockImplementation((sql: string) => Promise.resolve(
      sql.includes('SELECT EXISTS') ? [{ has_pos_locations: 1 }] : [],
    ));

    const response = await GET();
    const body = await response.json();

    expect(body.capabilities).toEqual({ hasPosLocations: true, xeroAccountingEnabled: false });
    expect(body.data).not.toHaveProperty('has_pos_locations');
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