import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRequireAdminTier,
  mockExecuteCashDeposit,
  mockReportRuntimeIssue,
  mockAssertXeroWorkflowEnabled,
  mockQuery,
  mockSyncAccess,
} = vi.hoisted(() => ({
  mockRequireAdminTier: vi.fn(),
  mockExecuteCashDeposit: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
  mockAssertXeroWorkflowEnabled: vi.fn(),
  mockQuery: vi.fn(),
  mockSyncAccess: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mockRequireAdminTier }));
vi.mock('@/lib/xero/advisorSyncAccess', () => ({ getXeroSyncAccessDenied: mockSyncAccess }));
vi.mock('@/lib/ims/cashDepositExecutor', () => ({ executeCashDeposit: mockExecuteCashDeposit }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));
vi.mock('@/services/MySQLService', () => ({ query: mockQuery }));
vi.mock('@/lib/xero/postingPolicy', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/xero/postingPolicy')>();
  return { ...actual, assertXeroWorkflowEnabled: mockAssertXeroWorkflowEnabled };
});

import { POST } from '../route';

const context = { params: { depositId: '7' } };

function request(): Request {
  return new Request('http://localhost/api/ims/money/cash-deposits/7/post', { method: 'POST' });
}

describe('POST /api/ims/money/cash-deposits/[depositId]/post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminTier.mockReturnValue({
      user: { businessId: 'biz-1', userId: 4, name: 'Admin', tier: 'Admin' },
      response: null,
    });
    mockAssertXeroWorkflowEnabled.mockResolvedValue(undefined);
    mockSyncAccess.mockResolvedValue(null);
    mockQuery.mockResolvedValue([{ accounting_method: 'solvantis' }]);
    mockExecuteCashDeposit.mockResolvedValue({ status: 'posted', completedActionIds: [1] });
  });

  it('posts a confirmed deposit when cash banking is enabled', async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mockAssertXeroWorkflowEnabled).toHaveBeenCalledWith('biz-1', 'posCashBankingEnabled');
    expect(mockExecuteCashDeposit).toHaveBeenCalledWith('biz-1', 7, { userId: 4, name: 'Admin' });
  });

  it('allows enabled Advisors to post an existing confirmed deposit', async () => {
    mockRequireAdminTier.mockReturnValue({ user: { businessId: 'biz-1', userId: 9, name: 'Advisor', tier: 'Advisor' } });
    expect((await POST(request(), context)).status).toBe(200);
    expect(mockExecuteCashDeposit).toHaveBeenCalledWith('biz-1', 7, { userId: 9, name: 'Advisor' });
  });

  it('blocks disabled Advisors before loading or posting a deposit', async () => {
    mockRequireAdminTier.mockReturnValue({ user: { businessId: 'biz-1', userId: 9, name: 'Advisor', tier: 'Advisor' } });
    mockSyncAccess.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await POST(request(), context)).status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockExecuteCashDeposit).not.toHaveBeenCalled();
  });

  it('returns 423 without claiming the deposit or reporting an issue when cash banking is disabled', async () => {
    const { XeroWorkflowDisabledError } = await import('@/lib/xero/postingPolicy');
    mockAssertXeroWorkflowEnabled.mockRejectedValueOnce(new XeroWorkflowDisabledError('posCashBankingEnabled'));

    const response = await POST(request(), context);

    expect(response.status).toBe(423);
    expect(await response.json()).toMatchObject({ code: 'xero_workflow_disabled' });
    expect(mockExecuteCashDeposit).not.toHaveBeenCalled();
    expect(mockReportRuntimeIssue).not.toHaveBeenCalled();
  });

  it('rejects a deposit already recorded in Xero before invoking the posting workflow', async () => {
    mockQuery.mockResolvedValueOnce([{ accounting_method: 'recorded_externally' }]);

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('already recorded in Xero') });
    expect(mockAssertXeroWorkflowEnabled).not.toHaveBeenCalled();
    expect(mockExecuteCashDeposit).not.toHaveBeenCalled();
  });
});
