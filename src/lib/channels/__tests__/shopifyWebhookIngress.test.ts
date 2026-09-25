import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mainQuery: vi.fn(), imsQuery: vi.fn(), imsExecute: vi.fn(), decrypt: vi.fn(), capability: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({ query: mocks.mainQuery }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/lib/encryption', () => ({ decrypt: mocks.decrypt }));
vi.mock('@/lib/ims/businessOperations', () => ({ assertShopifyEnabled: mocks.capability }));

import {
  claimShopifyWebhookEvent,
  finishShopifyWebhookEvent,
  stageShopifyWebhookEvent,
  verifyShopifyWebhook,
} from '@/lib/channels/shopifyWebhookIngress';

const rawBody = JSON.stringify({ id: 1001, email: 'not-persisted@example.com' });
const secret = 'webhook-secret';
const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
const request = { channelInstanceId: 'instance-1', rawBody, topic: 'orders/create', webhookId: 'webhook-1',
  shopDomain: 'retail.myshopify.com', hmac };
const row = { business_id: 'business-1', channel_instance_id: 'instance-1',
  external_account_key: 'retail.myshopify.com', is_enabled: 1, runtime_status: 'active',
  readiness_status: 'ready', encrypted_secret: 'encrypted', registration_status: 'registered' };

describe('Shopify webhook ingress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mainQuery.mockResolvedValue([row]);
    mocks.decrypt.mockReturnValue(secret);
    mocks.capability.mockResolvedValue(undefined);
  });

  it('verifies an exact registered instance and returns only safe envelope metadata', async () => {
    await expect(verifyShopifyWebhook(request)).resolves.toMatchObject({
      businessId: 'business-1', channelInstanceId: 'instance-1', topic: 'orders/create',
      webhookId: 'webhook-1', shopDomain: 'retail.myshopify.com',
    });
    expect(mocks.mainQuery).toHaveBeenCalledWith(expect.stringContaining("instance.provider = 'shopify'"),
      ['orders/create', 'instance-1']);
    expect(mocks.capability).toHaveBeenCalledWith('business-1');
  });

  it.each([
    [{ registration_status: 'pending' }, 'registration_inactive'],
    [{ is_enabled: 0 }, 'instance_inactive'],
    [{ runtime_status: 'paused' }, 'instance_inactive'],
    [{ readiness_status: 'not_tested' }, 'instance_not_ready'],
    [{ external_account_key: 'other.myshopify.com' }, 'domain_mismatch'],
  ])('rejects an unavailable or mismatched exact instance %#', async (override, code) => {
    mocks.mainQuery.mockResolvedValue([{ ...row, ...override }]);
    await expect(verifyShopifyWebhook(request)).rejects.toMatchObject({ code });
  });

  it('rejects the wrong topic registration or signature', async () => {
    mocks.mainQuery.mockResolvedValueOnce([]);
    await expect(verifyShopifyWebhook(request)).rejects.toMatchObject({ code: 'registration_not_found' });
    mocks.mainQuery.mockResolvedValueOnce([row]);
    await expect(verifyShopifyWebhook({ ...request, hmac: 'wrong' }))
      .rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('stages only a hash and exact routing identity, idempotently', async () => {
    mocks.imsExecute.mockResolvedValue({ affectedRows: 1 });
    mocks.imsQuery.mockResolvedValue([{ status: 'pending', attempts: 0 }]);
    const verified = await verifyShopifyWebhook(request);

    await expect(stageShopifyWebhookEvent(verified)).resolves.toBe('pending');
    const parameters = mocks.imsExecute.mock.calls[0][1];
    expect(parameters.slice(0, 4)).toEqual(['business-1', 'instance-1', 'orders/create', 'webhook-1']);
    expect(parameters[4]).not.toContain('not-persisted@example.com');
    expect(JSON.parse(parameters[4])).toEqual({
      shopDomain: 'retail.myshopify.com', payloadSha256: crypto.createHash('sha256').update(rawBody).digest('hex'),
    });
    expect(mocks.imsExecute.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE');
  });

  it('atomically claims pending or failed work and records terminal status', async () => {
    mocks.imsExecute.mockResolvedValueOnce({ affectedRows: 1 }).mockResolvedValueOnce({ affectedRows: 1 });
    const verified = await verifyShopifyWebhook(request);

    await expect(claimShopifyWebhookEvent(verified)).resolves.toBe(true);
    expect(mocks.imsExecute.mock.calls[0][0]).toContain("status IN ('pending','failed') AND attempts < 5");
    await finishShopifyWebhookEvent({ webhook: verified, status: 'failed', safeError: 'safe failure' });
    expect(mocks.imsExecute.mock.calls[1][1]).toEqual([
      'failed', 'safe failure', 'business-1', 'instance-1', 'webhook-1',
    ]);
    expect(mocks.imsExecute.mock.calls[1][0]).toContain("status = 'processing'");
  });
});