import { gzipSync } from 'node:zlib';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInstance: vi.fn(), setCursor: vi.fn(), access: vi.fn(), createReport: vi.fn(), getReport: vi.fn(),
  getDocument: vi.fn(), importObservations: vi.fn(),
  run: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  execute: vi.fn(), query: vi.fn(), report: vi.fn(),
}));
vi.mock('../channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  getForBusiness: mocks.getInstance, setAmazonReturnSyncCursorForBusiness: mocks.setCursor,
} }));
vi.mock('../amazonCredentials', () => ({ getAmazonChannelAccess: mocks.access }));
vi.mock('../amazonSpApi', () => ({
  createAmazonReturnsReport: mocks.createReport,
  getAmazonReport: mocks.getReport,
  downloadAmazonReportDocument: mocks.getDocument,
}));
vi.mock('../amazonReturnImport', () => ({ importAmazonReturnObservations: mocks.importObservations }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: mocks.execute, imsQuery: mocks.query }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { syncAmazonReturnsForChannel } from '../amazonReturnSync';

const reportTsv = [
  'Order ID\tAmazon RMA ID\tMerchant SKU\tReturn request date\tReturn request status\tReturn quantity',
  '111-2222222-3333333\tRMA-1\tSKU-1\t2026-09-15T00:00:00Z\tApproved\t1',
].join('\n');

describe('syncAmazonReturnsForChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.getInstance.mockResolvedValue({ provider: 'amazon', settings: {} });
    mocks.access.mockResolvedValue({ accessToken: 'access-token', sellerId: 'A1SELLER99' });
    mocks.execute.mockResolvedValue({ affectedRows: 1, insertId: 12 });
    mocks.createReport.mockResolvedValue('report-1');
    mocks.report.mockResolvedValue(1);
    mocks.importObservations.mockResolvedValue({ observed: 1, ignored: 0 });
  });

  it('requests one AU returns report and stores its exact instance window as a durable job', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(syncAmazonReturnsForChannel({
      businessId: 'business-1', channelInstanceId: 'instance-1', now: new Date('2026-09-16T00:02:00Z'),
    })).resolves.toEqual({ state: 'requested', observed: 0, ignored: 0 });

    expect(mocks.run).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(mocks.createReport).toHaveBeenCalledWith(
      'access-token', '2026-08-17T00:00:00.000Z', '2026-09-16T00:00:00.000Z',
    );
    const insert = mocks.execute.mock.calls.find(call => String(call[0]).includes('INSERT IGNORE INTO ims_sales_channel_jobs'));
    expect(insert?.[1]?.slice(0, 3)).toEqual([
      'business-1', 'instance-1', 'amazon:returns:2026-09-16T00:00:00.000Z',
    ]);
  });

  it('does not request or poll while an exact-instance report job is processing or in backoff', async () => {
    mocks.query.mockResolvedValue([{ id: 7, payload_json: {}, attempts: 1, status: 'processing', is_available: 1 }]);
    await expect(syncAmazonReturnsForChannel({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .resolves.toEqual({ state: 'pending', observed: 0, ignored: 0 });
    expect(mocks.createReport).not.toHaveBeenCalled();
    expect(mocks.getReport).not.toHaveBeenCalled();

    mocks.query.mockResolvedValue([{ id: 8, payload_json: {}, attempts: 1, status: 'pending', is_available: 0 }]);
    await expect(syncAmazonReturnsForChannel({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .resolves.toEqual({ state: 'pending', observed: 0, ignored: 0 });
    expect(mocks.createReport).not.toHaveBeenCalled();
    expect(mocks.getReport).not.toHaveBeenCalled();
  });

  it('downloads a completed GZIP report, imports observations, and advances the cursor last', async () => {
    mocks.query.mockResolvedValue([{
      id: 9, attempts: 0, status: 'pending', is_available: 1,
      payload_json: { reportId: 'report-1', dataStartTime: '2026-09-01T00:00:00Z', dataEndTime: '2026-09-16T00:00:00Z' },
    }]);
    mocks.getReport.mockResolvedValue({ processingStatus: 'DONE', reportDocumentId: 'document-1' });
    mocks.getDocument.mockResolvedValue({ url: 'https://download.example/report', compressionAlgorithm: 'GZIP' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(gzipSync(reportTsv))));

    await expect(syncAmazonReturnsForChannel({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .resolves.toEqual({ state: 'complete', observed: 1, ignored: 0 });
    expect(mocks.importObservations).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'instance-1',
      observations: [expect.objectContaining({ amazonOrderId: '111-2222222-3333333', amazonRmaId: 'RMA-1' })],
    }));
    expect(mocks.setCursor).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', lastRequestedAt: '2026-09-16T00:00:00Z',
    });
    expect(mocks.setCursor.mock.invocationCallOrder[0])
      .toBeGreaterThan(mocks.importObservations.mock.invocationCallOrder[0]);
  });

  it('backs off a failed report and leaves the cursor unchanged', async () => {
    mocks.query.mockResolvedValue([{
      id: 10, attempts: 1, status: 'pending', is_available: 1,
      payload_json: { reportId: 'report-2', dataEndTime: '2026-09-16T00:00:00Z' },
    }]);
    mocks.getReport.mockResolvedValue({ processingStatus: 'FATAL' });

    await expect(syncAmazonReturnsForChannel({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .rejects.toThrow('status FATAL');
    const retry = mocks.execute.mock.calls.find(call => String(call[0]).includes('DATE_ADD'));
    expect(retry?.[1]).toEqual([
      'pending', 60, 'Amazon returns report ended with status FATAL.', 10, 'business-1', 'instance-1',
    ]);
    expect(mocks.setCursor).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'sync_returns',
      context: expect.objectContaining({ channelInstanceId: 'instance-1', reportId: 'report-2', retry: true }),
    }));
  });

  it('completes an empty cancelled report window and advances its cursor', async () => {
    mocks.query.mockResolvedValue([{
      id: 11, attempts: 0, status: 'pending', is_available: 1,
      payload_json: { reportId: 'report-empty', dataEndTime: '2026-09-16T00:00:00Z' },
    }]);
    mocks.getReport.mockResolvedValue({ processingStatus: 'CANCELLED' });

    await expect(syncAmazonReturnsForChannel({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .resolves.toEqual({ state: 'complete', observed: 0, ignored: 0 });
    expect(mocks.getDocument).not.toHaveBeenCalled();
    expect(mocks.importObservations).not.toHaveBeenCalled();
    expect(mocks.setCursor).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', lastRequestedAt: '2026-09-16T00:00:00Z',
    });
  });
});