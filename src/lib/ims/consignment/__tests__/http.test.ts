import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), transaction: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('../db', () => ({ transaction: mocks.transaction }));
import { consignmentRequest, readBody } from '../http';
import { ConsignmentError } from '../domain';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ businessId: 'tenant-a', tier: 'Admin' });
  mocks.transaction.mockImplementation(async (_business, callback) => callback({}));
});
describe('consignment request permissions and tenant boundaries', () => {
  it('requires authentication before any tenant query', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await consignmentRequest('activity', false, vi.fn())).status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('allows report/history reads but not mutations for non-admin IMS users', async () => {
    mocks.session.mockResolvedValue({ businessId: 'tenant-a', tier: 'Advisor' });
    expect((await consignmentRequest('update', true, vi.fn())).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect((await consignmentRequest('history', false, async () => [])).status).toBe(200);
  });
  it('binds callback transactions to the authenticated tenant, never request data', async () => {
    await consignmentRequest('update', true, async () => ({ saved: true }));
    expect(mocks.transaction.mock.calls[0][0]).toBe('tenant-a');
  });
  it('does not report expected validation/auth failures as runtime incidents', async () => {
    const response = await consignmentRequest('finalise', true, async () => { throw new ConsignmentError('Refresh stale preview.', 409); });
    expect(response.status).toBe(409); expect(mocks.report).not.toHaveBeenCalled();
  });
  it('persists operational failures with tenant and source reference while hiding raw DB errors', async () => {
    const response = await consignmentRequest('finalise', true, async () => { throw new Error('Sensitive internal SQL failure'); });
    expect(response.status).toBe(500); expect(await response.text()).not.toContain('Sensitive internal SQL');
    expect(mocks.report.mock.calls[0][0]).toMatchObject({ businessId: 'tenant-a', source: 'ims.consignment', reference: { type: 'consignment-operation', id: 'finalise' } });
  });
  it('rejects malformed or non-object JSON as validation errors', async () => {
    await expect(readBody(new Request('http://localhost', { method: 'POST', body: '[' }))).rejects.toBeInstanceOf(ConsignmentError);
    await expect(readBody(new Request('http://localhost', { method: 'POST', body: '[]' }))).rejects.toBeInstanceOf(ConsignmentError);
  });
});
