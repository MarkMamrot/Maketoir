import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockImsQuery, mockImsExecute, mockXeroApiFetch } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
  mockXeroApiFetch: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery, imsExecute: mockImsExecute }));
vi.mock('@/services/XeroService', () => ({ xeroApiFetch: mockXeroApiFetch }));

import { GET } from '../route';

describe('GET /api/ims/xero/invoice-details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1' });
    mockImsQuery.mockResolvedValue([{ xero_invoice_id: 'xero-id-42' }]);
    mockImsExecute.mockResolvedValue({ affectedRows: 1 });
    mockXeroApiFetch.mockResolvedValue({
      Invoices: [{ InvoiceNumber: 'INV-1088', Total: 110, TotalTax: 10, Status: 'AUTHORISED' }],
    });
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