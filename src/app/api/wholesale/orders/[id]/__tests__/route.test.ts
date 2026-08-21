import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveWholesaleSession: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  imsQuery: vi.fn(),
  imsExecute: vi.fn(),
  reportRuntimeIssue: vi.fn().mockResolvedValue(1),
}));

vi.mock('@/lib/wholesale/wholesaleSession', () => ({
  requireActiveWholesaleSession: mocks.requireActiveWholesaleSession,
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET } from '../route';

const session = {
  businessId: 'biz-1', contactId: 42, companyId: 50, locationId: 60, memberId: 70,
  memberRole: 'owner', imsDb: 'ims-1', email: 'buyer@example.com', name: 'Buyer', company: 'Example Co',
};

describe('wholesale draft operational failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveWholesaleSession.mockResolvedValue({ session });
  });

  it('reports tenant query failures without exposing their message', async () => {
    mocks.imsQuery.mockRejectedValueOnce(new Error('private database detail'));

    const response = await GET(new Request('http://localhost'), { params: { id: '88' } });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ success: false, error: 'The draft could not be loaded.' });
    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      operation: 'load_draft_order',
      context: { wholesaleDraftId: 88 },
      reference: { type: 'wholesale_member', id: 70 },
    }));
  });
});