import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetImsSession, mockGenerateContent, mockCreateTrackedGoogleGenAI, mockGetConnection, mockReportRuntimeIssue } = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockGenerateContent: vi.fn(),
  mockCreateTrackedGoogleGenAI: vi.fn(),
  mockGetConnection: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/lib/ai/billing/googleGateway', () => ({ createTrackedGoogleGenAI: mockCreateTrackedGoogleGenAI }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mockGetConnection } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { POST } from '../route';

function pastedRequest(text = 'SKU\tProduct\tCost\nA-1\tWidget\t11.00'): Request {
  const form = new FormData();
  form.append('text', text);
  return new Request('http://localhost/api/ims/products/bulk-add-edit/extract', { method: 'POST', body: form });
}

describe('/api/ims/products/bulk-add-edit/extract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mockGetConnection.mockResolvedValue({ ai_document_extraction_model: 'gemini-test' });
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ currency: 'AUD', prices_include_tax: 'inc_tax', supplier_name: 'Acme Supply', products: [{ product_name: 'Widget', product_code: 'A-1', barcode: '00123', brand: 'Acme', unit_cost: 11, rrp: 24.95, tax_rate: 0.1 }] }),
    });
    mockCreateTrackedGoogleGenAI.mockReturnValue({ models: { generateContent: mockGenerateContent } });
  });

  it('rejects unauthenticated requests before extraction', async () => {
    mockGetImsSession.mockResolvedValue(null);

    const response = await POST(pastedRequest());

    expect(response.status).toBe(401);
    expect(mockCreateTrackedGoogleGenAI).not.toHaveBeenCalled();
  });

  it('extracts pasted rows through the tracked tenant AI boundary without catalogue matching', async () => {
    const response = await POST(pastedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, extraction: { currency: 'AUD', supplier_name: 'Acme Supply', products: [{ product_name: 'Widget', product_code: 'A-1', barcode: '00123', brand: 'Acme', supplier_name: 'Acme Supply', unit_cost: 10 }] } });
    expect(mockCreateTrackedGoogleGenAI).toHaveBeenCalledWith('test-key', expect.objectContaining({ businessId: 'business-1', operation: 'extract_bulk_products' }));
    expect(mockGenerateContent).toHaveBeenCalledOnce();
  });

  it('returns a generic price separately so the user can confirm its meaning', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        currency: 'AUD',
        prices_include_tax: 'unknown',
        source_price_column: 'Price',
        products: [{ product_name: 'Widget', product_code: 'A-1', source_price: 11 }],
      }),
    });

    const response = await POST(pastedRequest('SKU\tProduct\tPrice\nA-1\tWidget\t11.00'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.extraction).toMatchObject({
      source_price_column: 'Price',
      products: [{ product_name: 'Widget', source_price: 11, unit_cost: null, rrp: null }],
    });
  });

  it('requires one source and does not call AI for invalid input', async () => {
    const response = await POST(pastedRequest(''));

    expect(response.status).toBe(400);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});
