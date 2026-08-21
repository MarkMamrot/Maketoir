import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveWholesaleSession: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  imsQuery: vi.fn(),
  generateOrderPdf: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/wholesale/wholesaleSession', () => ({
  requireActiveWholesaleSession: mocks.requireActiveWholesaleSession,
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/lib/ims/generateOrderPdf', () => ({ generateOrderPdf: mocks.generateOrderPdf }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET } from '../route';

const session = {
  businessId: 'biz-1', contactId: 42, companyId: 50, locationId: 60, memberId: 70,
  memberRole: 'owner', imsDb: 'ims-1', email: 'buyer@example.com', name: 'Buyer', company: 'Example Co',
};
const params = { params: { id: '81' } };

describe('wholesale sales order PDF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveWholesaleSession.mockResolvedValue({ session, brandAccess: { mode: 'all', brands: null } });
    mocks.generateOrderPdf.mockResolvedValue(Buffer.from('pdf'));
  });

  it('requires a supported document type', async () => {
    const response = await GET(new Request('http://localhost/api/wholesale/sales-orders/81/pdf'), params);

    expect(response.status).toBe(400);
    expect(mocks.imsQuery).not.toHaveBeenCalled();
  });

  it('requires the active contact, account, member, and a current location grant', async () => {
    mocks.imsQuery.mockResolvedValueOnce([]);

    const response = await GET(new Request('http://localhost/api/wholesale/sales-orders/81/pdf?document=sales-order'), params);

    expect(response.status).toBe(404);
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('o.wholesale_company_id = ?');
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('EXISTS (');
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('ml.location_id = o.wholesale_location_id');
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('o.wholesale_member_id = ?');
    expect(mocks.imsQuery.mock.calls[0][0]).not.toContain('o.notes');
    expect(mocks.imsQuery.mock.calls[0][1]).toEqual([81, 'biz-1', 42, 50, 70]);
    expect(mocks.generateOrderPdf).not.toHaveBeenCalled();
  });

  it('blocks a tax invoice before fulfilment', async () => {
    mocks.imsQuery.mockResolvedValueOnce([{ id: 81, so_number: 'SO-0081', status: 'confirmed' }]);

    const response = await GET(new Request('http://localhost/api/wholesale/sales-orders/81/pdf?document=tax-invoice'), params);

    expect(response.status).toBe(409);
    expect(mocks.generateOrderPdf).not.toHaveBeenCalled();
  });

  it('generates an owned document from allowlisted order data without internal notes', async () => {
    mocks.imsQuery
      .mockResolvedValueOnce([{
        id: 81, so_number: 'SO-0081', status: 'fulfilled', order_date: '2026-08-20',
        xero_invoice_number: 'INV-1081', customer_name: 'Example Co', customer_email: 'buyer@example.com',
        location_name: 'Primary', subtotal: 100, tax_amount: 10, total_amount: 110,
      }])
      .mockResolvedValueOnce([{ id: 9, variant_id: 'variant-1', product_name: 'Raincoat', qty_ordered: 2 }])
      .mockResolvedValueOnce([{ key: 'business_name', value: 'Supplier Co' }]);

    const response = await GET(new Request('http://localhost/api/wholesale/sales-orders/81/pdf?document=tax-invoice'), params);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('INV-1081.pdf');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const options = mocks.generateOrderPdf.mock.calls[0][0];
    expect(options).toMatchObject({
      type: 'so',
      businessName: 'Supplier Co',
      salesDocumentType: 'tax-invoice',
      xeroInvoiceNumber: 'INV-1081',
      order: { id: 81, customer_name: 'Example Co', items: [{ id: 9 }] },
    });
    expect(options.order).not.toHaveProperty('notes');
  });
});