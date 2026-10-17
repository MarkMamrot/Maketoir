import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/pos/products/sync/route';
import { CatalogueRequestError } from '../catalogueSync.server';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), pos: vi.fn(), session: vi.fn(), run: vi.fn(), connection: vi.fn(),
  query: vi.fn(), release: vi.fn(), sync: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ getAdminSession: mocks.admin, getPosSession: mocks.pos }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: () => ({ getConnection: mocks.connection }) }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('../catalogueSync.server', async importOriginal => ({
  ...await importOriginal<typeof import('../catalogueSync.server')>(), catalogueSync: mocks.sync,
}));

const request = (location = '1', body: unknown = { consumerId: crypto.randomUUID(), full: false }) =>
  new Request(`http://localhost/api/pos/products/sync?location_id=${location}`, { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockReturnValue(null);
  mocks.pos.mockReturnValue({ businessId: 'alpha', location_id: 1 });
  mocks.session.mockResolvedValue({ businessId: 'alpha' });
  mocks.run.mockImplementation(async (_business: string, work: () => Promise<unknown>) => work());
  mocks.connection.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.query.mockResolvedValue([[{ id: 1 }]]);
  mocks.sync.mockResolvedValue({ protocol: 2, mode: 'disabled', retryAfterMs: 300000 });
  mocks.report.mockResolvedValue(undefined);
});

describe('catalogue sync API fencing and errors', () => {
  it('blocks anonymous requests before resolving a tenant', async () => {
    mocks.pos.mockReturnValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', 'NaN', '1.5', ''])('rejects invalid location %s', async location => {
    expect((await POST(request(location))).status).toBe(400);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('restricts a cashier to the authenticated location', async () => {
    expect((await POST(request('2'))).status).toBe(403);
    expect(mocks.connection).not.toHaveBeenCalled();
  });

  it('uses the verified admin business ahead of a stale POS cookie', async () => {
    mocks.admin.mockReturnValue({ businessId: 'admin-business' });
    expect((await POST(request('2'))).status).toBe(200);
    expect(mocks.session).toHaveBeenCalledWith(['marketoir_session']);
    expect(mocks.run).toHaveBeenCalledWith('admin-business', expect.any(Function));
    expect(mocks.sync).toHaveBeenCalledWith(expect.any(Object), 'admin-business', 2, expect.any(Object));
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('does not trust a body-supplied business', async () => {
    await POST(request('1', { consumerId: crypto.randomUUID(), full: false, businessId: 'victim' }));
    expect(mocks.run).toHaveBeenCalledWith('alpha', expect.any(Function));
  });

  it('rejects invalid request JSON and invalid consumer identities', async () => {
    expect((await POST(new Request('http://localhost/api/pos/products/sync?location_id=1', { method: 'POST', body: '{' }))).status).toBe(400);
    expect((await POST(request('1', { consumerId: '', full: false }))).status).toBe(400);
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('requires the requested location to be active in this business', async () => {
    mocks.query.mockResolvedValue([[]]);
    expect((await POST(request())).status).toBe(404);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('returns expected receipt conflicts without creating runtime incidents', async () => {
    mocks.sync.mockRejectedValue(new CatalogueRequestError('Expired receipt.', 409));
    expect((await POST(request())).status).toBe(409);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('reports an operational tenant-resolution failure explicitly', async () => {
    mocks.run.mockRejectedValue(new Error('Tenant mapping unavailable.'));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'alpha', operation: 'catalogue_sync' }));
  });
});
