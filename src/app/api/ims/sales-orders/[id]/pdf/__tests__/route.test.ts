import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockGet, mockImsQuery, mockGeneratePdf, mockReportRuntimeIssue } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockGet: vi.fn(),
  mockImsQuery: vi.fn(),
  mockGeneratePdf: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsSORepo: { get: mockGet } }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/ims/generateOrderPdf', () => ({ generateOrderPdf: mockGeneratePdf }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { GET } from '../route';

const params = { params: { id: '42' } };

describe('GET /api/ims/sales-orders/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1', company: 'Example Co' });
    mockImsQuery.mockResolvedValue([
      { key: 'sales_document_show_logo', value: '0' },
      { key: 'sales_document_bank_bsb', value: '123-456' },
    ]);
    mockGeneratePdf.mockResolvedValue(Buffer.from('pdf'));
  });

  it('requires an explicit supported document type', async () => {
    const response = await GET(new Request('http://localhost/api/ims/sales-orders/42/pdf'), params);

    expect(response.status).toBe(400);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('blocks a tax invoice before full fulfilment', async () => {
    mockGet.mockResolvedValue({ id: 42, so_number: 'SO-0042', status: 'confirmed' });

    const response = await GET(new Request('http://localhost/api/ims/sales-orders/42/pdf?document=tax-invoice'), params);

    expect(response.status).toBe(409);
    expect(mockGeneratePdf).not.toHaveBeenCalled();
  });

  it('generates a fulfilled tax invoice with cached Xero identity and settings', async () => {
    mockGet.mockResolvedValue({
      id: 42,
      so_number: 'SO-0042',
      status: 'fulfilled',
      xero_invoice_number: 'INV-1088',
    });

    const response = await GET(new Request('http://localhost/api/ims/sales-orders/42/pdf?document=tax-invoice'), params);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('INV-1088.pdf');
    expect(mockGeneratePdf).toHaveBeenCalledWith(expect.objectContaining({
      salesDocumentType: 'tax-invoice',
      xeroInvoiceNumber: 'INV-1088',
      showSalesDocumentLogo: false,
      bankingDetails: expect.objectContaining({ bsb: '123-456' }),
    }));
  });
});