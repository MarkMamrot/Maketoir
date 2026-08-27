import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminTier, mockRunImsForBusiness, mockListRewards, mockImsExecute, mockReportRuntimeIssue } = vi.hoisted(() => ({
  mockRequireAdminTier: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
  mockListRewards: vi.fn(),
  mockImsExecute: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mockRequireAdminTier }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));
vi.mock('@/lib/ims/LoyaltyRepository', () => ({ LoyaltyRepository: { listRewards: mockListRewards } }));
vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: mockImsExecute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { GET, PUT } from '../route';

function request(rewards: unknown): Request {
  return new Request('http://localhost/api/ims/loyalty/rewards', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rewards }),
  });
}

describe('/api/ims/loyalty/rewards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminTier.mockReturnValue({ user: { businessId: 'business-1', userId: 8 } });
    mockRunImsForBusiness.mockImplementation(async (_businessId: string, callback: () => Promise<unknown>) => callback());
    mockListRewards.mockResolvedValue([{ id: 4, rewardCode: 'FIVE_OFF', displayName: '$5 off', pointsCost: 500, valueAud: 5, isActive: true }]);
    mockImsExecute.mockResolvedValue({ affectedRows: 1 });
    mockReportRuntimeIssue.mockResolvedValue(null);
  });

  it('requires an administrator', async () => {
    const response = new Response(null, { status: 401 });
    mockRequireAdminTier.mockReturnValue({ response });
    expect(await GET()).toBe(response);
    expect(mockRunImsForBusiness).not.toHaveBeenCalled();
  });

  it('loads all rewards inside the authenticated tenant context', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mockRunImsForBusiness).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(mockListRewards).toHaveBeenCalledWith('business-1', false);
  });

  it('rejects invalid reward values before writing', async () => {
    const response = await PUT(request([{ rewardCode: 'bad code', displayName: '', pointsCost: 0, valueAud: 0 }]));
    expect(response.status).toBe(400);
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('creates and updates tenant-owned reward definitions', async () => {
    const response = await PUT(request([
      { id: 4, rewardCode: 'FIVE_OFF', displayName: '$5 off', description: '', pointsCost: 500, valueAud: 5, isActive: true, sortOrder: 0 },
      { rewardCode: 'TEN_OFF', displayName: '$10 off', pointsCost: 900, valueAud: 10, isActive: false, sortOrder: 1 },
    ]));
    expect(response.status).toBe(200);
    expect(mockImsExecute).toHaveBeenCalledTimes(2);
    expect(mockImsExecute.mock.calls[0][0]).toContain('WHERE id = ? AND business_id = ?');
    expect(mockImsExecute.mock.calls[0][1]).toContain('business-1');
    expect(mockImsExecute.mock.calls[1][0]).toContain('INSERT INTO loyalty_rewards');
  });
});