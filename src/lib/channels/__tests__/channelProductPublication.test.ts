import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), query: vi.fn(), report: vi.fn(),
  run: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: mocks.execute, imsQuery: mocks.query }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));

import {
  CHANNEL_PRODUCT_PUBLICATION_OPERATION,
  enqueueChannelProductPublicationJobs,
  processChannelProductPublicationJobs,
  syncChannelProductPublications,
} from '../channelProductPublication';

describe('channel product publication jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
  });

  it('queues only current assignment/provider mismatches in the exact channel instance', async () => {
    mocks.execute.mockResolvedValueOnce({ affectedRows: 3 });
    await expect(enqueueChannelProductPublicationJobs({
      businessId: 'business-1',
      channelInstanceId: 'instance-1',
      provider: 'shopify',
    })).resolves.toBe(3);

    const [sql, params] = mocks.execute.mock.calls[0];
    expect(sql).toContain('INSERT IGNORE INTO ims_sales_channel_jobs');
    expect(sql).toContain("assignment.desired_state = 'published' AND assignment.provider_state <> 'published'");
    expect(sql).toContain("assignment.desired_state = 'unpublished' AND assignment.provider_state IN ('published', 'pending', 'error')");
    expect(sql).toContain("CONCAT('product_publication:', assignment.product_id, ':', assignment.desired_state");
    expect(sql).toContain("DATE_FORMAT(assignment.updated_at, '%Y%m%d%H%i%s%f')");
    expect(params).toEqual(['shopify', CHANNEL_PRODUCT_PUBLICATION_OPERATION, 'business-1', 'instance-1']);
  });

  it('queues and processes only explicitly selected products for a targeted run', async () => {
    mocks.execute.mockResolvedValueOnce({ affectedRows: 1 });
    await enqueueChannelProductPublicationJobs({
      businessId: 'business-1', channelInstanceId: 'instance-1', provider: 'shopify', productIds: ['product-2'],
    });
    expect(mocks.execute.mock.calls[0][0]).toContain('assignment.product_id IN (?)');
    expect(mocks.execute.mock.calls[0][1]).toEqual([
      'shopify', CHANNEL_PRODUCT_PUBLICATION_OPERATION, 'business-1', 'instance-1', 'product-2',
    ]);

    mocks.query.mockResolvedValue([]);
    await processChannelProductPublicationJobs({
      businessId: 'business-1', channelInstanceId: 'instance-1', provider: 'shopify',
      adapter: vi.fn(), productIds: ['product-2'],
    });
    expect(mocks.query.mock.calls[0][0]).toContain("JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.productId')) IN (?)");
    expect(mocks.query.mock.calls[0][1]).toEqual([
      'business-1', 'instance-1', 'shopify', CHANNEL_PRODUCT_PUBLICATION_OPERATION, 'product-2',
    ]);
  });

  it('revalidates current intent before applying and skips a stale job', async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: 7, payload_json: { productId: 'product-1', desiredState: 'published' }, attempts: 0 }])
      .mockResolvedValueOnce([{ desired_state: 'unpublished' }]);
    const adapter = vi.fn();

    await expect(processChannelProductPublicationJobs({
      businessId: 'business-1', channelInstanceId: 'instance-1', provider: 'native_shop', adapter,
    })).resolves.toEqual({ processed: 1, applied: 0, blocked: 0, skipped: 1, failed: 0 });
    expect(adapter).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls.at(-1)?.[0]).toContain('Skipped because assignment intent changed.');
  });

  it('records a successful provider observation without changing newer intent', async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: 8, payload_json: '{"productId":"product-2","desiredState":"published"}', attempts: 0 }])
      .mockResolvedValueOnce([{ desired_state: 'published' }]);
    const adapter = vi.fn().mockResolvedValue({ outcome: 'applied', providerState: 'published', externalProductId: 'external-2' });

    await expect(processChannelProductPublicationJobs({
      businessId: 'business-1', channelInstanceId: 'instance-1', provider: 'shopify', adapter,
    })).resolves.toEqual({ processed: 1, applied: 1, blocked: 0, skipped: 0, failed: 0 });
    expect(adapter).toHaveBeenCalledWith(expect.objectContaining({ productId: 'product-2', desiredState: 'published' }));
    const assignmentUpdate = mocks.execute.mock.calls.find(call => String(call[0]).includes("readiness_status = 'ready'"));
    expect(assignmentUpdate?.[1]).toEqual(['published', 'external-2', 'business-1', 'instance-1', 'product-2', 'published']);
  });

  it('uses callback tenant context for detached publication work', async () => {
    mocks.query.mockResolvedValue([]);
    await syncChannelProductPublications({
      businessId: 'business-1', channelInstanceId: 'instance-1', provider: 'native_shop', adapter: vi.fn(), enqueue: false,
    });
    expect(mocks.run).toHaveBeenCalledWith('business-1', expect.any(Function));
  });
});