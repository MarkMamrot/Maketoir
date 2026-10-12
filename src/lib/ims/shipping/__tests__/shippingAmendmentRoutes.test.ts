import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, PATCH } from '@/app/api/ims/shipping/shipments/[id]/route';
import { POST as quote } from '@/app/api/ims/shipping/shipments/[id]/quotes/route';
import { POST as reconcile } from '@/app/api/ims/shipping/shipments/[id]/reconcile/route';
import { ShippingAmendmentError } from '../shippingAmendmentPolicy';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), context: vi.fn(), get: vi.fn(), amend: vi.fn(), quote: vi.fn(), reconcile: vi.fn(), runtime: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.context }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.runtime }));
vi.mock('../shippingAmendments', () => ({
  getShippingEditableDetail: mocks.get, amendShippingShipment: mocks.amend,
  quoteShippingAmendment: mocks.quote, reconcileShippingAmendment: mocks.reconcile,
}));
const params = { params: { id: '1' } };
const service = { serviceCode: 'T28', serviceName: 'Parcel Post', total: 11, totalExGst: 10, gst: 1 };
const request = () => new Request('http://localhost/api/ims/shipping/shipments/1', { method: 'PATCH', body: JSON.stringify({ businessId: 'wrong-tenant', service }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ businessId: 'tenant-1', tier: 'Retail' });
  mocks.context.mockImplementation(async (_businessId: string, action: () => Promise<unknown>) => action());
  mocks.get.mockResolvedValue({ shipmentId: 1 });
  mocks.amend.mockResolvedValue({ shipment: { shipmentId: 1 }, affectedShipmentIds: [1], requiresFreshLabels: false });
  mocks.quote.mockResolvedValue([]);
  mocks.reconcile.mockResolvedValue({ shipment: { shipmentId: 1 }, affectedShipmentIds: [1, 2], requiresFreshLabels: true });
});
describe('shipment amendment auth and response contracts', () => {
  it.each([GET, PATCH, quote, reconcile])('requires authentication before data access', async action => {
    mocks.session.mockResolvedValue(null);
    const response = await action(request(), params);
    expect(response.status).toBe(401);
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it.each([PATCH, quote, reconcile])('denies Advisor writes before parsing or data access', async action => {
    mocks.session.mockResolvedValue({ businessId: 'tenant-1', tier: 'Advisor' });
    expect((await action(request(), params)).status).toBe(403);
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it('allows Advisor read-only detail access', async () => {
    mocks.session.mockResolvedValue({ businessId: 'tenant-1', tier: 'Advisor' });
    expect((await GET(request(), params)).status).toBe(200);
  });
  it('binds the authenticated tenant explicitly and ignores body tenant spoofing', async () => {
    const response = await PATCH(request(), params);
    expect(response.status).toBe(200);
    expect(mocks.context).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(mocks.amend).toHaveBeenCalledWith('tenant-1', 1, { businessId: 'wrong-tenant', service });
  });
  it('requires a service even when a client attempts the internal preparation-only flag', async () => {
    const response = await PATCH(new Request('http://localhost', {
      method: 'PATCH', body: JSON.stringify({ preparationOnly: true, service: null }),
    }), params);
    expect(response.status).toBe(400);
    expect(mocks.amend).not.toHaveBeenCalled();
  });
  it('returns validation400 and stale/unknown409 with affected shared-label IDs', async () => {
    mocks.amend.mockRejectedValueOnce(new ShippingAmendmentError('Invalid parcels.', 400));
    expect((await PATCH(request(), params)).status).toBe(400);
    mocks.amend.mockRejectedValueOnce(new ShippingAmendmentError('Readback required.', 409, [1, 2], true));
    const response = await PATCH(request(), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: 'Readback required.', affectedShipmentIds: [1, 2], requiresFreshLabels: true });
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it('returns malformed JSON and invalid shipment IDs as400', async () => {
    expect((await PATCH(new Request('http://localhost', { method: 'PATCH', body: '{' }), params)).status).toBe(400);
    expect((await GET(request(), { params: { id: 'NaN' } })).status).toBe(400);
  });
  it('records operational failure with safe tenant/reference context', async () => {
    mocks.get.mockRejectedValue(new Error('ECONNRESET secret customer payload'));
    const response = await GET(request(), params);
    expect(response.status).toBe(502);
    expect(mocks.runtime).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'tenant-1', reference: { type: 'shipping_shipment', id: 1 }, context: { shipmentId: 1, errorType: 'Error' },
    }));
    expect(JSON.stringify(mocks.runtime.mock.calls)).not.toContain('secret customer payload');
  });
});
