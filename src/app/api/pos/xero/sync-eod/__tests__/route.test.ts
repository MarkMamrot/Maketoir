import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ admin: vi.fn(), session: vi.fn(), access: vi.fn(), query: vi.fn(), rows: vi.fn(), sync: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }));
vi.mock('@/lib/sessionUtils', () => ({ getAdminSession: mocks.admin }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/xero/advisorSyncAccess', () => ({ getXeroSyncAccessDenied: mocks.access }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: (_businessId: string, callback: () => unknown) => callback() }));
vi.mock('@/lib/db/PosRepository', () => ({ PosEodRepo: { get: mocks.rows, setXeroInvoice: vi.fn(), setXeroPayment: vi.fn(), setXeroPaymentError: vi.fn() } }));
vi.mock('@/services/XeroSyncService', () => ({ triggerEodXeroSync: mocks.sync }));
vi.mock('@/lib/ims/notifySyncFailure', () => ({ notifySyncFailure: vi.fn() }));
import { POST } from '../route';

describe('POS EOD Xero retry access', () => {
  const request = () => new Request('http://localhost/api/pos/xero/sync-eod', { method: 'POST', body: JSON.stringify({ locationId: 1, date: '2026-09-03' }) });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.admin.mockReturnValue({ businessId: 'biz-1', tier: 'Advisor' });
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    mocks.access.mockResolvedValue(null);
    mocks.query.mockResolvedValue([{ name: 'Store', business_id: 'biz-1' }]);
    mocks.rows.mockResolvedValue([]);
    mocks.sync.mockResolvedValue([]);
  });
  it('blocks disabled Advisors before reading or syncing EOD rows', async () => {
    mocks.access.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await POST(request())).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('allows enabled Advisors to retry existing EOD accounting', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('business_id = ?'), [1, 'biz-1']);
    expect(mocks.sync).toHaveBeenCalledOnce();
  });
  it('blocks an invalid bound session', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('does not sync a location outside the authenticated business', async () => {
    mocks.query.mockResolvedValue([]);
    expect((await POST(request())).status).toBe(404);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});