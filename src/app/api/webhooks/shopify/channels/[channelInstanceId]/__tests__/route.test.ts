import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), stage: vi.fn(), claim: vi.fn(), finish: vi.fn(), importOrder: vi.fn(),
  cancelOrder: vi.fn(), fulfilOrder: vi.fn(), refundOrder: vi.fn(), getInstance: vi.fn(), getDb: vi.fn(), run: vi.fn(), report: vi.fn(),
  paidLoyalty: vi.fn(), reconcileGiftCards: vi.fn(), updateOrder: vi.fn(),
}));
vi.mock('@/lib/channels/shopifyWebhookIngress', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/channels/shopifyWebhookIngress')>();
  return { ...actual, verifyShopifyWebhook: mocks.verify, stageShopifyWebhookEvent: mocks.stage,
    claimShopifyWebhookEvent: mocks.claim, finishShopifyWebhookEvent: mocks.finish };
});
vi.mock('@/lib/channels/channelInstanceRepository', () => ({
  SalesChannelInstanceRepository: { getForBusiness: mocks.getInstance },
}));
vi.mock('@/lib/channels/shopifyOrderImport', () => ({
  importShopifyOrder: mocks.importOrder,
  cancelShopifyOrder: mocks.cancelOrder,
}));
vi.mock('@/lib/channels/shopifyOrderFulfilment', () => ({
  applyShopifyOrderFulfilment: mocks.fulfilOrder,
}));
vi.mock('@/lib/channels/shopifyOrderRefund', () => ({ applyShopifyOrderRefund: mocks.refundOrder }));
vi.mock('@/lib/channels/shopifyPaidOrderLoyalty', () => ({ applyShopifyPaidOrderLoyalty: mocks.paidLoyalty }));
vi.mock('@/lib/ims/shopifyGiftCardWebhook', () => ({ reconcileGiftCardsFromPaidShopifyOrder: mocks.reconcileGiftCards }));
vi.mock('@/lib/channels/shopifyOrderUpdate', () => ({ updateShopifyOrder: mocks.updateOrder }));
vi.mock('@/lib/db/BusinessRegistry', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/db/BusinessRegistry')>(),
  getImsDbNameStrict: mocks.getDb,
  runImsForBusiness: mocks.run,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/ims/businessOperations', () => ({ isOnlineChannelDisabledError: () => false }));

import { ShopifyWebhookIngressError } from '@/lib/channels/shopifyWebhookIngress';
import { POST } from '@/app/api/webhooks/shopify/channels/[channelInstanceId]/route';

function request(topic = 'orders/create') {
  return new Request('http://localhost/api/webhooks/shopify/channels/instance-1', {
    method: 'POST',
    headers: {
      'x-shopify-topic': topic,
      'x-shopify-webhook-id': 'webhook-1',
      'x-shopify-shop-domain': 'retail.myshopify.com',
      'x-shopify-hmac-sha256': 'signature',
    },
    body: JSON.stringify({ id: 1001, created_at: '2026-09-25T01:00:00Z' }),
  });
}

describe('exact-instance Shopify webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ businessId: 'business-1', channelInstanceId: 'instance-1',
      topic: 'orders/create', webhookId: 'webhook-1', shopDomain: 'retail.myshopify.com', payloadHash: 'hash' });
    mocks.getDb.mockResolvedValue('tenant_schema');
    mocks.getInstance.mockResolvedValue({ provider: 'shopify', settings: { shopify: {
      orders: { enabled: true, locationId: 7, syncFrom: '2026-09-01' },
    } } });
    mocks.stage.mockResolvedValue('pending');
    mocks.claim.mockResolvedValue(true);
    mocks.finish.mockResolvedValue(undefined);
    mocks.importOrder.mockResolvedValue({ outcome: 'imported', salesOrderId: 44 });
    mocks.cancelOrder.mockResolvedValue({ outcome: 'cancelled', salesOrderId: 44 });
    mocks.fulfilOrder.mockResolvedValue({ outcome: 'fulfilled', salesOrderId: 44 });
    mocks.refundOrder.mockResolvedValue({ outcome: 'refunded', salesOrderId: 44, creditNoteId: 81 });
    mocks.paidLoyalty.mockResolvedValue(undefined);
    mocks.updateOrder.mockResolvedValue({ outcome: 'updated', salesOrderId: 44 });
    mocks.report.mockResolvedValue(undefined);
    mocks.run.mockImplementation(async (_businessId: string, callback: () => Promise<unknown>) => callback());
  });

  it('verifies before entering the exact tenant and stages the event in callback context', async () => {
    const response = await POST(request(), { params: { channelInstanceId: 'instance-1' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, eventStatus: 'complete', outcome: 'imported', salesOrderId: 44 });
    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({
      channelInstanceId: 'instance-1', topic: 'orders/create', webhookId: 'webhook-1',
      shopDomain: 'retail.myshopify.com', hmac: 'signature',
      rawBody: JSON.stringify({ id: 1001, created_at: '2026-09-25T01:00:00Z' }),
    }));
    expect(mocks.getDb).toHaveBeenCalledWith('business-1');
    expect(mocks.run).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(mocks.stage).toHaveBeenCalledWith(expect.objectContaining({ channelInstanceId: 'instance-1' }));
    expect(mocks.claim).toHaveBeenCalled();
    expect(mocks.importOrder).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'instance-1', locationId: 7, topic: 'orders/create',
    }));
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'complete' }));
  });

  it('never resolves or enters a tenant when exact-instance verification fails', async () => {
    mocks.verify.mockRejectedValue(new ShopifyWebhookIngressError('invalid_signature', 401, 'Invalid signature.'));

    const response = await POST(request(), { params: { channelInstanceId: 'instance-1' } });

    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it('applies exact loyalty only after a paid order is imported', async () => {
    mocks.verify.mockResolvedValue({ businessId: 'business-1', channelInstanceId: 'instance-1',
      topic: 'orders/paid', webhookId: 'webhook-1', shopDomain: 'retail.myshopify.com', payloadHash: 'hash' });

    const response = await POST(request('orders/paid'), { params: { channelInstanceId: 'instance-1' } });

    expect(response.status).toBe(200);
    expect(mocks.importOrder).toHaveBeenCalled();
    expect(mocks.paidLoyalty).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'instance-1',
    }));
    expect(mocks.reconcileGiftCards).toHaveBeenCalledWith(
      'business-1',
      'instance-1',
      expect.objectContaining({ id: 1001 }),
    );
  });

  it('does not process a duplicate delivery after the atomic claim loses', async () => {
    mocks.claim.mockResolvedValue(false);

    const response = await POST(request(), { params: { channelInstanceId: 'instance-1' } });

    expect(await response.json()).toEqual({ ok: true, eventStatus: 'duplicate' });
    expect(mocks.importOrder).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it('marks unsupported topics ignored without invoking legacy processing', async () => {
    mocks.verify.mockResolvedValue({ businessId: 'business-1', channelInstanceId: 'instance-1',
      topic: 'customers/update', webhookId: 'webhook-1', shopDomain: 'retail.myshopify.com', payloadHash: 'hash' });

    const response = await POST(request('customers/update'), { params: { channelInstanceId: 'instance-1' } });

    expect(await response.json()).toEqual({ ok: true, eventStatus: 'ignored' });
    expect(mocks.importOrder).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'ignored' }));
  });

  it('marks order events ignored while exact-instance order ingestion is disabled', async () => {
    mocks.getInstance.mockResolvedValue({ provider: 'shopify', settings: { shopify: {
      orders: { enabled: false, locationId: 7, syncFrom: '2026-09-01' },
    } } });

    const response = await POST(request(), { params: { channelInstanceId: 'instance-1' } });

    expect(await response.json()).toEqual({ ok: true, eventStatus: 'ignored' });
    expect(mocks.importOrder).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'ignored' }));
  });

  it('routes cancellation to the exact instance without requiring an import location', async () => {
    mocks.verify.mockResolvedValue({ businessId: 'business-1', channelInstanceId: 'instance-1',
      topic: 'orders/cancelled', webhookId: 'webhook-1', shopDomain: 'retail.myshopify.com', payloadHash: 'hash' });
    mocks.getInstance.mockResolvedValue({ provider: 'shopify', settings: { shopify: {
      orders: { enabled: true, syncFrom: '2026-09-01' },
    } } });

    const response = await POST(request('orders/cancelled'), { params: { channelInstanceId: 'instance-1' } });

    expect(await response.json()).toEqual({
      ok: true, eventStatus: 'complete', outcome: 'cancelled', salesOrderId: 44,
    });
    expect(mocks.cancelOrder).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'instance-1',
    }));
    expect(mocks.importOrder).not.toHaveBeenCalled();
  });

  it('records return updates without repeating refund or stock processing', async () => {
    mocks.verify.mockResolvedValue({ businessId: 'business-1', channelInstanceId: 'instance-1',
      topic: 'returns/update', webhookId: 'webhook-1', shopDomain: 'retail.myshopify.com', payloadHash: 'hash' });

    const response = await POST(request('returns/update'), { params: { channelInstanceId: 'instance-1' } });

    expect(await response.json()).toEqual({ ok: true, eventStatus: 'complete', outcome: 'observed' });
    expect(mocks.refundOrder).not.toHaveBeenCalled();
    expect(mocks.importOrder).not.toHaveBeenCalled();
  });

  it('routes fulfilment to the exact instance without requiring an import location', async () => {
    mocks.verify.mockResolvedValue({ businessId: 'business-1', channelInstanceId: 'instance-1',
      topic: 'fulfillments/create', webhookId: 'webhook-1', shopDomain: 'retail.myshopify.com', payloadHash: 'hash' });
    mocks.getInstance.mockResolvedValue({ provider: 'shopify', settings: { shopify: {
      orders: { enabled: true, syncFrom: '2026-09-01' },
    } } });

    const response = await POST(request('fulfillments/create'), { params: { channelInstanceId: 'instance-1' } });

    expect(await response.json()).toEqual({
      ok: true, eventStatus: 'complete', outcome: 'fulfilled', salesOrderId: 44,
    });
    expect(mocks.fulfilOrder).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'instance-1', topic: 'fulfillments/create',
    }));
    expect(mocks.importOrder).not.toHaveBeenCalled();
  });

  it('routes refunds to the exact instance without invoking legacy processing', async () => {
    mocks.verify.mockResolvedValue({ businessId: 'business-1', channelInstanceId: 'instance-1',
      topic: 'refunds/create', webhookId: 'webhook-1', shopDomain: 'retail.myshopify.com', payloadHash: 'hash' });

    const response = await POST(request('refunds/create'), { params: { channelInstanceId: 'instance-1' } });

    expect(await response.json()).toEqual({
      ok: true, eventStatus: 'complete', outcome: 'refunded', salesOrderId: 44, creditNoteId: 81,
    });
    expect(mocks.refundOrder).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'instance-1',
    }));
    expect(mocks.importOrder).not.toHaveBeenCalled();
  });

  it('routes order updates to the exact instance without invoking import', async () => {
    mocks.verify.mockResolvedValue({ businessId: 'business-1', channelInstanceId: 'instance-1',
      topic: 'orders/updated', webhookId: 'webhook-1', shopDomain: 'retail.myshopify.com', payloadHash: 'hash' });

    const response = await POST(request('orders/updated'), { params: { channelInstanceId: 'instance-1' } });

    expect(await response.json()).toEqual({
      ok: true, eventStatus: 'complete', outcome: 'updated', salesOrderId: 44,
    });
    expect(mocks.updateOrder).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'instance-1',
    }));
    expect(mocks.importOrder).not.toHaveBeenCalled();
  });

  it('reports a tenant mapping or staging failure with safe exact-instance context', async () => {
    mocks.getDb.mockResolvedValue(null);

    const response = await POST(request(), { params: { channelInstanceId: 'instance-1' } });

    expect(response.status).toBe(500);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'process_exact_instance_event',
      context: { channelInstanceId: 'instance-1', topic: 'orders/create' },
    }));
  });
});