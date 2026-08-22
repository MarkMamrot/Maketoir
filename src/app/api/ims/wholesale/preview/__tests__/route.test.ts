import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdminTier: vi.fn(),
  getImsDbNameStrict: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  reportRuntimeIssue: vi.fn(),
  getActiveWholesaleBuyer: vi.fn(),
  signWholesalePreviewSession: vi.fn(() => 'signed-preview'),
  getProfile: vi.fn(),
  imsExecute: vi.fn(),
  imsQuery: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: () => ({ set: mocks.cookieSet }) }));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mocks.requireAdminTier }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ getImsDbNameStrict: mocks.getImsDbNameStrict, runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('@/lib/wholesale/wholesaleIdentity', () => ({ getActiveWholesaleBuyer: mocks.getActiveWholesaleBuyer }));
vi.mock('@/lib/wholesale/wholesaleSession', () => ({
  signWholesalePreviewSession: mocks.signWholesalePreviewSession,
  WHOLESALE_PREVIEW_SESSION_COOKIE: 'wholesale_preview_session',
  WHOLESALE_PREVIEW_SESSION_MAX_AGE: 1800,
}));
vi.mock('@/lib/wholesale/wholesaleSupplierProfile', () => ({ WholesaleSupplierProfileRepository: { getByBusinessId: mocks.getProfile } }));
vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: mocks.imsExecute, imsQuery: mocks.imsQuery }));

import { POST } from '../route';

const user = { businessId: 'biz-1', userId: 7, name: 'Admin User', email: 'admin@example.com', tier: 'Admin' };

describe('IMS wholesale preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminTier.mockReturnValue({ user });
    mocks.getProfile.mockResolvedValue({ isActive: true, slug: 'supplier' });
    mocks.getImsDbNameStrict.mockResolvedValue('ims_biz_1');
    mocks.imsQuery.mockResolvedValue([{ contact_id: 11 }]);
    mocks.getActiveWholesaleBuyer.mockResolvedValue({
      contactId: 11, businessId: 'biz-1', email: 'buyer@example.com', name: 'Buyer', company: 'Buyer Co',
      companyId: 22, locationId: 33, memberId: 44, memberRole: 'owner',
    });
    mocks.imsExecute.mockResolvedValue({ affectedRows: 1 });
  });

  it('persists and signs the explicitly requested test-checkout mode', async () => {
    const response = await POST(new Request('http://localhost/api/ims/wholesale/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: 44, locationId: 33, mode: 'ims_draft_test' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.runImsForBusiness).toHaveBeenCalledWith('biz-1', expect.any(Function));
    expect(mocks.imsExecute.mock.calls[0][1]).toEqual(['biz-1', 'wholesale_staff_preview_mode', 'ims_draft_test']);
    expect(mocks.signWholesalePreviewSession).toHaveBeenCalledWith(expect.objectContaining({
      preview: expect.objectContaining({ mode: 'ims_draft_test', actorUserId: 7 }),
    }));
    expect(mocks.cookieSet).toHaveBeenCalledWith('wholesale_preview_session', 'signed-preview', expect.objectContaining({ maxAge: 1800, path: '/' }));
  });

  it('rejects a missing or unsupported requested mode', async () => {
    const response = await POST(new Request('http://localhost/api/ims/wholesale/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: 44, locationId: 33, mode: 'full_access' }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.imsExecute).not.toHaveBeenCalled();
  });
});
