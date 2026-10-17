import type { PoolConnection } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineSyncLeaseLostError } from '../onlineSyncPolicy';

const mocks = vi.hoisted(() => ({
  active: vi.fn(), control: vi.fn(), query: vi.fn(), execute: vi.fn(), report: vi.fn(),
  claim: vi.fn(), effect: vi.fn(), complete: vi.fn(), release: vi.fn(), quarantine: vi.fn(),
  importOrder: vi.fn(), update: vi.fn(), cancel: vi.fn(), fulfil: vi.fn(), refund: vi.fn(),
  facts: vi.fn(), dirty: vi.fn(), enqueue: vi.fn(), lock: vi.fn(), context: vi.fn(), detail: vi.fn(),
}));
vi.mock('../onlineSyncControl', () => ({
  assertOnlineRecoveryBusinessActive: mocks.active, getOnlineSyncControl: mocks.control,
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: async () => 'UTC' }));
vi.mock('@/lib/ims/costing/fifoCostingService', () => ({ lockInventoryCostState: mocks.lock }));
vi.mock('../shopifyOrderCoordination', () => ({
  claimShopifyOrderSnapshot: mocks.claim, runShopifyOrderEffect: mocks.effect,
  completeShopifyOrderSnapshot: mocks.complete, releaseShopifyOrderLease: mocks.release,
  quarantineShopifyOrderSnapshot: mocks.quarantine,
}));
vi.mock('../shopifyOrderImport', () => ({
  importShopifyOrderInTransaction: mocks.importOrder, cancelShopifyOrderInTransaction: mocks.cancel,
}));
vi.mock('../shopifyOrderUpdate', () => ({ updateShopifyOrderInTransaction: mocks.update }));
vi.mock('../shopifyOrderLocalEffects', () => ({
  applyCoordinatedShopifyFulfilment: mocks.fulfil, applyCoordinatedShopifyRefund: mocks.refund,
}));
vi.mock('../shopifyRecoveryDayFacts', () => ({
  readShopifyAccountingFacts: mocks.facts, markOnlineDayChanged: mocks.dirty,
}));
vi.mock('../onlineSyncJobs', () => ({ enqueueOnlineSyncJob: mocks.enqueue }));
vi.mock('../shopifyOperationContext', () => ({ getShopifyOperationContext: mocks.context }));
vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: class { getOrderForReconciliation = mocks.detail; },
}));

import { applyShopifyRecoverySnapshot, queueShopifyRecoveryEvent } from '../shopifyOrderRecovery';

const partial: Pick<PoolConnection, 'execute'> = { execute: vi.fn() };
const connection = partial as PoolConnection;
function order(): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: '123', created_at: now, updated_at: now, financial_status: 'paid', currency: 'AUD',
    cancelled_at: null, fulfillment_status: null, subtotal_price: '20', total_tax: '2',
    total_price: '22', total_discounts: '0', line_items: [{ id: '456', quantity: 2, price: '11' }],
    fulfillments: [], refunds: [],
  };
}
function input(source = order()) {
  return {
    businessId: 'alpha', channelInstanceId: 'store', locationId: 7, order: source,
    syncFrom: '2026-01-01', deadline: Date.now() + 30_000,
  };
}

describe('full-source recovery orchestration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([{ id: 44 }]);
    mocks.claim.mockImplementation(async snapshot => ({ status: 'ready', lease: { ...snapshot, token: 'token' } }));
    mocks.effect.mockImplementation(async (_lease, _key, apply) => ({
      duplicate: false, result: await apply(connection),
    }));
    mocks.facts.mockResolvedValue({ hash: 'a', businessDate: '2026-10-17' });
    mocks.importOrder.mockResolvedValue({ salesOrderId: 44 });
    mocks.update.mockResolvedValue({ salesOrderId: 44 });
    mocks.cancel.mockResolvedValue({ salesOrderId: 44 });
  });

  it('updates existing records without running the import identity path and queues exact hash work', async () => {
    expect(await applyShopifyRecoverySnapshot(input())).toBe('applied');
    expect(mocks.importOrder).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls[0][0]).toBe(connection);
    expect(mocks.dirty).not.toHaveBeenCalled();
    const descriptor = mocks.enqueue.mock.calls[0][0];
    expect(descriptor).toMatchObject({
      businessId: 'alpha', channelInstanceId: 'store',
      payload: { kind: 'order_effects', orderId: '123', paid: true, refundIds: [] },
    });
    expect(descriptor.operationKey).toBe(`effects:123:${descriptor.payload.hash}`);
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('imports missing current-day orders then captures update-only root facts', async () => {
    mocks.query.mockResolvedValue([]);
    mocks.facts.mockResolvedValueOnce(null).mockResolvedValueOnce({ hash: 'b', businessDate: '2026-10-17' });
    await applyShopifyRecoverySnapshot(input());
    expect(mocks.importOrder).toHaveBeenCalledOnce();
    expect(mocks.importOrder.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]);
    expect(mocks.dirty).toHaveBeenCalledWith(connection, expect.objectContaining({ externalOrderId: '123' }), '2026-10-17');
  });
  it('dirties both dates when a persisted financial order changes business date', async () => {
    mocks.facts.mockResolvedValueOnce({ hash: 'a', businessDate: '2026-10-15' })
      .mockResolvedValueOnce({ hash: 'b', businessDate: '2026-10-16' });
    await applyShopifyRecoverySnapshot(input());
    expect(mocks.dirty.mock.calls.map(call => call[2])).toEqual(['2026-10-16', '2026-10-15']);
  });
  it('applies partial fulfilments before refunds and durable downstream handoff', async () => {
    await applyShopifyRecoverySnapshot(input({
      ...order(), fulfillments: [{ id: '7001', status: 'success' }], refunds: [{ id: '8001' }],
    }));
    expect(mocks.fulfil.mock.invocationCallOrder[0]).toBeLessThan(mocks.refund.mock.invocationCallOrder[0]);
    expect(mocks.refund.mock.invocationCallOrder[0]).toBeLessThan(mocks.enqueue.mock.invocationCallOrder[0]);
    expect(mocks.refund.mock.calls[0][1]).toMatchObject({ id: '8001', order_id: '123' });
  });
  it('quarantines missing historical stock rather than manufacturing fulfilment provenance', async () => {
    mocks.query.mockResolvedValue([]);
    expect(await applyShopifyRecoverySnapshot(input({
      ...order(), created_at: '2026-01-02T00:00:00Z', fulfillments: [{ id: '7001', status: 'success' }],
    }))).toBe('review');
    expect(mocks.quarantine).toHaveBeenCalledWith(expect.anything(), '2026-01-02', 'historical_stock_evidence_missing');
    expect(mocks.effect).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it.each(['stale', 'duplicate', 'review'])('does not mutate %s snapshots', async status => {
    mocks.claim.mockResolvedValue({ status });
    expect(await applyShopifyRecoverySnapshot(input())).toBe(status === 'review' ? 'review' : 'already_current');
    expect(mocks.effect).not.toHaveBeenCalled();
  });
  it('does not turn a partial webhook payload into a full-source fence', async () => {
    await expect(applyShopifyRecoverySnapshot(input({ id: '123' }))).rejects.toThrow();
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it('rejects an impossible configured calendar date before claiming or mutating', async () => {
    await expect(applyShopifyRecoverySnapshot({ ...input(), syncFrom: '2026-02-30' })).rejects.toThrow();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.effect).not.toHaveBeenCalled();
  });
  it('rechecks main automation/deletion before the first effect', async () => {
    mocks.active.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new OnlineSyncLeaseLostError());
    await expect(applyShopifyRecoverySnapshot(input())).rejects.toThrow('no longer owned');
    expect(mocks.effect).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('does not commit a completion after an effect fails', async () => {
    mocks.update.mockRejectedValue(new Error('local write failed'));
    await expect(applyShopifyRecoverySnapshot(input())).rejects.toThrow('local write failed');
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});

describe('authenticated webhook durable handoff', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockResolvedValue([{ id: 1 }]);
    mocks.control.mockResolvedValue({ mode: 'cutover', paused: true });
  });
  it('deduplicates the delivery identity and saves only its owning order, even while paused', async () => {
    const delivery = {
      businessId: 'alpha', channelInstanceId: 'store', topic: 'refunds/create',
      eventId: 'delivery-1', payload: { id: '8001', order_id: '123', customer: { email: 'private' } },
    };
    expect(await queueShopifyRecoveryEvent(delivery)).toMatchObject({ outcome: 'queued' });
    await queueShopifyRecoveryEvent(delivery);
    expect(mocks.execute.mock.calls[0][1]).toEqual(mocks.execute.mock.calls[1][1]);
    expect(mocks.execute.mock.calls[0][1][3]).toBe('{"kind":"order_snapshot","orderId":"123"}');
    expect(mocks.detail).not.toHaveBeenCalled();
  });
  it('does not acknowledge an event without a durable exact-owner job', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(queueShopifyRecoveryEvent({
      businessId: 'alpha', channelInstanceId: 'store', topic: 'orders/create', payload: { id: '123' },
    })).rejects.toThrow('not durably queued');
  });
});
