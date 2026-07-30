import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRequireAdminSession,
  mockAssertBusinessAccess,
  mockQuery,
  mockRunImsForBusiness,
  mockPlan,
  mockExecute,
  mockSyncOnlineDailySalesDay,
} = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockQuery: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
  mockPlan: vi.fn(),
  mockExecute: vi.fn(),
  mockSyncOnlineDailySalesDay: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  assertBusinessAccess: mockAssertBusinessAccess,
}));
vi.mock('@/services/MySQLService', () => ({ query: mockQuery }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));
vi.mock('@/lib/ims/shopifyPayoutActionPlanner', () => ({ planShopifyPayoutActions: mockPlan }));
vi.mock('@/lib/ims/shopifyPayoutActionExecutor', () => ({ executeShopifyPayoutActions: mockExecute }));
vi.mock('@/lib/xero/onlineDailySalesSync', () => ({ syncOnlineDailySalesDay: mockSyncOnlineDailySalesDay }));

import { GET, POST } from '../route';

const context = { params: { payoutId: 'pay-1' } };

function request(method = 'GET', body?: unknown) {
  return new NextRequest('http://localhost/api/xero/shopify-payouts/pay-1?databaseId=biz-1', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('/api/xero/shopify-payouts/[payoutId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'biz-1' }, response: null });
    mockAssertBusinessAccess.mockReturnValue(null);
    mockRunImsForBusiness.mockImplementation((_businessId: string, callback: () => Promise<unknown>) => callback());
    mockPlan.mockResolvedValue({ status: 'planned', actions: [{ actionKey: 'one' }] });
    mockExecute.mockResolvedValue({ status: 'reconciled', completedActionIds: [1] });
    mockSyncOnlineDailySalesDay.mockResolvedValue({
      xeroId: 'invoice-1', totalSales: 337.04, totalTax: 30.64, giftCardAmount: 0, orderCount: 5,
    });
  });

  it('returns payout preview, actions, and canonical transactions', async () => {
    mockQuery
      .mockResolvedValueOnce([{ shopify_payout_id: 'pay-1', reconciliation_status: 'planned' }])
      .mockResolvedValueOnce([{ id: 1, action_type: 'invoice_payment' }])
      .mockResolvedValueOnce([{ shopify_transaction_id: 'tx-1' }]);

    const response = await GET(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.actions).toHaveLength(1);
    expect(body.transactions).toHaveLength(1);
  });

  it('replans inside callback-form tenant context', async () => {
    const response = await POST(request('POST', { action: 'plan' }), context);

    expect(response.status).toBe(200);
    expect(mockRunImsForBusiness).toHaveBeenCalledWith('biz-1', expect.any(Function));
    expect(mockPlan).toHaveBeenCalledWith('biz-1', 'pay-1');
  });

  it('executes planned actions without tenant IMS access', async () => {
    const response = await POST(request('POST', { action: 'execute' }), context);

    expect(response.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith('biz-1', 'pay-1');
    expect(mockRunImsForBusiness).not.toHaveBeenCalled();
  });

  it('repairs linked daily invoices and replans without posting payout actions', async () => {
    mockQuery
      .mockResolvedValueOnce([{ reconciliation_status: 'blocked', completed_actions: 0 }])
      .mockResolvedValueOnce([{ batch_date: '2026-07-27' }]);

    const response = await POST(request('POST', { action: 'repair' }), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockSyncOnlineDailySalesDay).toHaveBeenCalledWith('biz-1', '2026-07-27');
    expect(mockPlan).toHaveBeenCalledWith('biz-1', 'pay-1');
    expect(mockExecute).not.toHaveBeenCalled();
    expect(body).toMatchObject({ status: 'planned', refreshed: [{ date: '2026-07-27', xeroId: 'invoice-1' }] });
  });

  it('returns the exact replan blocker after invoice repair', async () => {
    mockQuery
      .mockResolvedValueOnce([{ reconciliation_status: 'blocked', completed_actions: 0 }])
      .mockResolvedValueOnce([{ batch_date: '2026-07-27' }]);
    mockPlan.mockResolvedValueOnce({
      status: 'blocked',
      error: 'Refund refund-1 amount 12.95 does not match completed credit note 0.00',
      actions: [],
    });

    const response = await POST(request('POST', { action: 'repair' }), context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('Refund refund-1 amount 12.95 does not match completed credit note 0.00');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects cross-business access before reading payout data', async () => {
    mockAssertBusinessAccess.mockReturnValueOnce(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));

    const response = await GET(request(), context);

    expect(response.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});