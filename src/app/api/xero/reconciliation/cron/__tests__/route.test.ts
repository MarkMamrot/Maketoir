import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockExecute, mockRunIms, mockBootstrap, mockScan, mockReportIssue } = vi.hoisted(() => ({
  mockQuery: vi.fn(), mockExecute: vi.fn(), mockRunIms: vi.fn(), mockBootstrap: vi.fn(),
  mockScan: vi.fn(), mockReportIssue: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ query: mockQuery, execute: mockExecute }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunIms }));
vi.mock('@/lib/xero/reconciliation/bootstrap', () => ({ bootstrapHistoricalXeroTargets: mockBootstrap }));
vi.mock('@/lib/xero/reconciliation/scanner', () => ({ scanXeroReconciliationTargets: mockScan }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportIssue }));

import { POST } from '../route';

function request(secret?: string) {
  return new Request('http://localhost/api/xero/reconciliation/cron', {
    method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {},
  });
}

describe('POST /api/xero/reconciliation/cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockRunIms.mockImplementation(async (_businessId, callback) => callback());
    mockBootstrap.mockResolvedValue({
      discovered: 4, inserted: 4,
      cursors: { purchaseOrder: 11, salesOrder: 22, customerCreditNote: 33, supplierCreditNote: 44 },
    });
    mockReportIssue.mockResolvedValue(1);
    mockScan.mockResolvedValue({
      targetCount: 100, checkedCount: 100, mismatchCount: 2, failedBatches: 0,
      unsupportedCount: 0, nextCursor: 150, hasMore: true,
    });
  });

  it('rejects requests without the shared cron secret', async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('advances one bounded page for each connected business', async () => {
    mockQuery.mockResolvedValue([
      { business_id: 'biz-1', next_target_id: 50, scan_limit: 100 },
      { business_id: 'biz-2', next_target_id: 0, scan_limit: 1000 },
    ]);

    const response = await POST(request('test-secret'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.processed).toBe(2);
    expect(mockRunIms.mock.calls.map(call => call[0])).toEqual(['biz-1', 'biz-2']);
    expect(mockBootstrap).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', limitPerType: 25,
    }));
    expect(mockScan).toHaveBeenNthCalledWith(1, { businessId: 'biz-1', afterId: 50, limit: 100 });
    expect(mockScan).toHaveBeenNthCalledWith(2, { businessId: 'biz-2', afterId: 0, limit: 500 });
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('bootstrap_po_id = ?'), [150, 11, 22, 33, 44, 'biz-1']);
  });

  it('wraps the cursor after the final page', async () => {
    mockQuery.mockResolvedValue([{ business_id: 'biz-1', next_target_id: 150, scan_limit: 100 }]);
    mockScan.mockResolvedValueOnce({
      targetCount: 8, checkedCount: 8, mismatchCount: 0, failedBatches: 0,
      unsupportedCount: 0, nextCursor: 158, hasMore: false,
    });

    await POST(request('test-secret'));

    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('next_target_id = ?'), [0, 11, 22, 33, 44, 'biz-1']);
  });

  it('keeps a failed cursor unchanged and continues to the next business', async () => {
    mockQuery.mockResolvedValue([
      { business_id: 'biz-1', next_target_id: 50, scan_limit: 100 },
      { business_id: 'biz-2', next_target_id: 80, scan_limit: 100 },
    ]);
    mockScan.mockRejectedValueOnce(new Error('Xero unavailable')).mockResolvedValueOnce({
      targetCount: 2, checkedCount: 2, mismatchCount: 0, failedBatches: 0,
      unsupportedCount: 0, nextCursor: 82, hasMore: false,
    });

    const response = await POST(request('test-secret'));
    const json = await response.json();

    expect(json.results.map((result: { outcome: string }) => result.outcome)).toEqual(['error', 'completed']);
    expect(mockScan).toHaveBeenCalledTimes(2);
    expect(mockReportIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', operation: 'cron_business_scan', context: { afterId: 50, limit: 100 },
    }));
  });

  it('reports a schedule-load failure without scanning', async () => {
    mockQuery.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await POST(request('test-secret'));

    expect(response.status).toBe(500);
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockReportIssue).toHaveBeenCalledWith(expect.objectContaining({ operation: 'cron_load_schedules' }));
  });
});