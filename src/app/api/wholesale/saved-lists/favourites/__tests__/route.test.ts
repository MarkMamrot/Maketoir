import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveWholesaleSession: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  imsQuery: vi.fn(), imsExecute: vi.fn(), reportRuntimeIssue: vi.fn(),
  validateWholesaleOrderItems: vi.fn(),
}));
vi.mock('@/lib/wholesale/wholesaleSession', () => ({ requireActiveWholesaleSession: mocks.requireActiveWholesaleSession }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('@/lib/wholesale/wholesaleOrderItems', () => ({
  validateWholesaleOrderItems: mocks.validateWholesaleOrderItems,
  WholesaleItemValidationError: class WholesaleItemValidationError extends Error {},
}));

import { GET, PUT } from '../route';

const session = { businessId: 'biz-1', companyId: 50, memberId: 70, memberRole: 'buyer' };

describe('wholesale favourites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveWholesaleSession.mockResolvedValue({ session, brandAccess: { mode: 'all', brands: null } });
    mocks.validateWholesaleOrderItems.mockResolvedValue([]);
  });

  it('reads favourites only for the active member', async () => {
    mocks.imsQuery.mockResolvedValueOnce([{ variant_id: 'variant-1' }]);

    await expect((await GET()).json()).resolves.toEqual({ success: true, variantIds: ['variant-1'] });
    expect(mocks.imsQuery.mock.calls[0][1]).toEqual(['biz-1', 50, 70]);
  });

  it('writes the favourite with the full member account tuple', async () => {
    mocks.imsExecute.mockResolvedValueOnce({ affectedRows: 1 });
    const request = new Request('http://localhost', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantId: 'variant-1', favourite: true }),
    });

    expect((await PUT(request)).status).toBe(200);
    expect(mocks.validateWholesaleOrderItems).toHaveBeenCalledWith(
      'biz-1', { mode: 'all', brands: null }, [{ variant_id: 'variant-1', qty: 1 }],
    );
    expect(mocks.imsExecute.mock.calls[0][1]).toEqual(['biz-1', 50, 70, 'variant-1']);
  });
});