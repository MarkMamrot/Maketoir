import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRequireAdminTier,
  mockExecuteCashDeposit,
  mockReportRuntimeIssue,
  mockAssertXeroWorkflowEnabled,
} = vi.hoisted(() => ({
  mockRequireAdminTier: vi.fn(),
  mockExecuteCashDeposit: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
  mockAssertXeroWorkflowEnabled: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mockRequireAdminTier }));
vi.mock('@/lib/ims/cashDepositExecutor', () => ({ executeCashDeposit: mockExecuteCashDeposit }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));
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
      user: { businessId: 'biz-1', userId: 4, name: 'Admin' },
      response: null,
    });
    mockAssertXeroWorkflowEnabled.mockResolvedValue(undefined);
    mockExecuteCashDeposit.mockResolvedValue({ status: 'posted', completedActionIds: [1] });
  });

  it('posts a confirmed deposit when cash banking is enabled', async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mockAssertXeroWorkflowEnabled).toHaveBeenCalledWith('biz-1', 'posCashBankingEnabled');
    expect(mockExecuteCashDeposit).toHaveBeenCalledWith('biz-1', 7, { userId: 4, name: 'Admin' });
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
});
