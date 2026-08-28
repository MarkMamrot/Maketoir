import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockImsQuery, mockImsExecute, mockXeroApiFetch, mockAssertXeroAccountingEnabled } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
  mockXeroApiFetch: vi.fn(),
  mockAssertXeroAccountingEnabled: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery, imsExecute: mockImsExecute }));
vi.mock('@/services/XeroService', () => ({ xeroApiFetch: mockXeroApiFetch }));
vi.mock('@/lib/ims/businessOperations', () => ({ assertXeroAccountingEnabled: mockAssertXeroAccountingEnabled }));

import { GET } from '../route';

describe('GET /api/ims/xero/invoice-details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1' });
    mockAssertXeroAccountingEnabled.mockResolvedValue(undefined);
    mockImsQuery.mockResolvedValue([{ xero_invoice_id: 'xero-id-42' }]);
    mockImsExecute.mockResolvedValue({ affectedRows: 1 });
    mockXeroApiFetch.mockResolvedValue({
      Invoices: [{ InvoiceNumber: 'INV-1088', Total: 110, TotalTax: 10, Status: 'AUTHORISED' }],
    });
  });

  it('rejects disabled tenants before reading or caching invoice state', async () => {
    mockAssertXeroAccountingEnabled.mockRejectedValueOnce(Object.assign(new Error('Xero accounting is disabled.'), { status: 403 }));

    const response = await GET(new Request('http://localhost/api/ims/xero/invoice-details?soId=42'));

    expect(response.status).toBe(403);
    expect(mockImsQuery).not.toHaveBeenCalled();
    expect(mockXeroApiFetch).not.toHaveBeenCalled();
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('caches the live invoice number against the tenant-owned linked order', async () => {
    const response = await GET(new Request('http://localhost/api/ims/xero/invoice-details?soId=42'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invoiceNumber).toBe('INV-1088');
    expect(mockImsExecute).toHaveBeenCalledWith(
      expect.stringContaining('xero_invoice_number = ?'),
      ['INV-1088', 42, 'biz-1', 'xero-id-42'],
    );
  });
});