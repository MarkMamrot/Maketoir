import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, PUT } from '@/app/api/ims/shipping/preparation/[id]/route';
import { ShippingAmendmentError } from '../shippingAmendmentPolicy';

const mocks = vi.hoisted(() => ({ session: vi.fn(), get: vi.fn(), save: vi.fn(), report: vi.fn(), context: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.context }));
vi.mock('../shippingPreparation', () => ({ getShippingOrderPreparation: mocks.get, saveShippingOrderPreparation: mocks.save }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
const context = { params: { id: '10' } };
const request = (body: unknown = {}) => new Request('http://localhost/api/ims/shipping/preparation/10', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ businessId: 'tenant-a', tier: 'Admin' });
  mocks.context.mockImplementation(async (_businessId: string, action: () => Promise<unknown>) => action());
  mocks.get.mockResolvedValue(null);
  mocks.save.mockResolvedValue({ shipment: { shipmentId: 1 } });
});
describe('tenant-safe order preparation route', () => {
  it('returns empty preparation for an authenticated ready order', async () => {
    const response = await GET(new Request('http://localhost'), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: null });
    expect(mocks.get).toHaveBeenCalledWith('tenant-a', 10);
  });
  it('writes only for the resolved tenant and ignores a body-supplied tenant', async () => {
    const response = await PUT(request({ businessId: 'tenant-b', operationKey: 'key' }), context);
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith('tenant-a', 10, expect.objectContaining({ businessId: 'tenant-b' }));
    expect(mocks.context).toHaveBeenCalledWith('tenant-a', expect.any(Function));
  });
  it('blocks anonymous access', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await PUT(request(), context)).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('blocks advisor writes but permits preparation reads', async () => {
    mocks.session.mockResolvedValue({ businessId: 'tenant-a', tier: 'Advisor' });
    expect((await PUT(request(), context)).status).toBe(403);
    expect((await GET(new Request('http://localhost'), context)).status).toBe(200);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', 'abc', '1.2'])('rejects invalid order reference %s', async id => {
    expect((await PUT(request(), { params: { id } })).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON without reporting an operational failure', async () => {
    const response = await PUT(new Request('http://localhost', { method: 'PUT', body: '{' }), context);
    expect(response.status).toBe(400);
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('surfaces stale preparation conflicts without reporting validation as runtime failure', async () => {
    mocks.save.mockRejectedValue(new ShippingAmendmentError('Reload saved dimensions.', 409));
    const response = await PUT(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'Reload saved dimensions.' });
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('records unexpected operational failures with tenant-safe context', async () => {
    mocks.save.mockRejectedValue(new Error('database unavailable'));
    const response = await PUT(request(), context);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'Unable to load or save order dimensions.' });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'tenant-a', operation: 'save_order_preparation', context: { soId: 10 },
    }));
  });
});
