import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSession,
  mockGet,
  mockUpdate,
  mockXeroUpdate,
  mockGetXeroInvoiceStatus,
  mockReportRuntimeIssue,
} = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
  mockXeroUpdate: vi.fn(),
  mockGetXeroInvoiceStatus: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsSORepo: { get: mockGet, update: mockUpdate },
}));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: vi.fn() }));
vi.mock('@/lib/ims/xeroHooks', () => ({
  triggerSOXeroSync: vi.fn(),
  triggerSOXeroVoid: vi.fn(),
  triggerSOXeroUpdate: mockXeroUpdate,
}));
vi.mock('@/services/XeroSyncService', () => ({ getXeroInvoiceStatus: mockGetXeroInvoiceStatus }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { PUT } from '../route';

const params = { params: { id: '42' } };
const request = () => new Request('http://localhost/api/ims/sales-orders/42', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ notes: 'changed' }),
});

describe('PUT /api/ims/sales-orders/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1', tier: 'Admin' });
    mockUpdate.mockResolvedValue(undefined);
    mockXeroUpdate.mockResolvedValue(undefined);
    mockReportRuntimeIssue.mockResolvedValue(undefined);
  });

  it('blocks edits when a fulfilled SO has an Authorised Xero invoice', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'fulfilled', xero_invoice_id: 'xero-invoice-1', items: [] });
    mockGetXeroInvoiceStatus.mockResolvedValue('AUTHORISED');

    const response = await PUT(request(), params);

    expect(response.status).toBe(409);
    expect(mockGetXeroInvoiceStatus).toHaveBeenCalledWith('biz-1', 'xero-invoice-1');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockXeroUpdate).not.toHaveBeenCalled();
  });

  it('allows edits when a fulfilled SO Xero invoice is still Draft', async () => {
    mockGet.mockResolvedValue({ id: 42, status: 'fulfilled', xero_invoice_id: 'xero-invoice-1', items: [] });
    mockGetXeroInvoiceStatus.mockResolvedValue('DRAFT');

    const response = await PUT(request(), params);

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockXeroUpdate).toHaveBeenCalledWith('biz-1', 42);
  });
});
