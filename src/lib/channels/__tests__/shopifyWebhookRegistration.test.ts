import { describe, expect, it, vi } from 'vitest';

import {
  reconcileShopifyWebhooks,
  SHOPIFY_EXACT_WEBHOOK_TOPICS,
} from '@/lib/channels/shopifyWebhookRegistration';

function dependencies(options?: { secret?: string | null; webhooks?: unknown[]; failTopics?: string[] }) {
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.method) return new Response(JSON.stringify({ webhooks: options?.webhooks ?? [] }), { status: 200 });
    const request = JSON.parse(String(init.body));
    if (options?.failTopics?.includes(request.webhook.topic)) {
      return new Response(JSON.stringify({ errors: 'scope unavailable' }), { status: 422 });
    }
    return new Response(JSON.stringify({ webhook: { ...request.webhook, id: `id-${request.webhook.topic}` } }), { status: 200 });
  });
  const mainExecute = vi.fn(async () => ({ affectedRows: 1 }));
  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    mainQuery: vi.fn(async () => []),
    mainExecute,
    loadContext: vi.fn(async () => ({
      credentials: { shopDomain: 'store-a.myshopify.com', token: 'token' },
    })) as any,
    loadCredentialSecret: vi.fn(async () => options?.secret ?? null),
    encryptSecret: vi.fn((value: string) => `encrypted:${value}`),
  } as any;
}

describe('reconcileShopifyWebhooks', () => {
  it('registers every supported topic against the exact storefront callback', async () => {
    const deps = dependencies({ secret: 'app-secret' });
    const result = await reconcileShopifyWebhooks({
      businessId: 'business-a',
      channelInstanceId: 'instance-a',
      callbackUrl: 'https://ims.example/api/webhooks/shopify/channels/instance-a',
    }, deps);

    expect(result.registered).toBe(SHOPIFY_EXACT_WEBHOOK_TOPICS.length);
    expect(result.failed).toEqual([]);
    expect(deps.mainExecute).toHaveBeenCalledTimes(SHOPIFY_EXACT_WEBHOOK_TOPICS.length);
    expect(deps.mainExecute.mock.calls.every((call: any[]) => call[1][0] === 'instance-a')).toBe(true);
  });

  it('records unavailable optional topics and continues registering later topics', async () => {
    const deps = dependencies({ secret: 'app-secret', failTopics: ['returns/update'] });
    const result = await reconcileShopifyWebhooks({
      businessId: 'business-a',
      channelInstanceId: 'instance-a',
      callbackUrl: 'https://ims.example/api/webhooks/shopify/channels/instance-a',
    }, deps);

    expect(result.failed).toEqual([{ topic: 'returns/update', error: 'Shopify webhook request failed with HTTP 422.', optional: true }]);
    expect(result.registered).toBe(SHOPIFY_EXACT_WEBHOOK_TOPICS.length - 1);
    expect(deps.fetchImpl.mock.calls.some(([url]: [string]) => url.endsWith('/webhooks.json')
      && !url.includes('?') )).toBe(true);
    expect(deps.mainExecute).toHaveBeenCalledWith(expect.stringContaining("registration_status, safe_error"), [
      'instance-a', 'returns/update', 'encrypted:app-secret', 'Shopify webhook request failed with HTTP 422.',
    ]);
  });

  it('fails before provider mutation when no exact signing secret is available', async () => {
    const deps = dependencies({ secret: null });
    await expect(reconcileShopifyWebhooks({
      businessId: 'business-a',
      channelInstanceId: 'instance-a',
      callbackUrl: 'https://ims.example/api/webhooks/shopify/channels/instance-a',
    }, deps)).rejects.toThrow('signing secret');
    expect(deps.fetchImpl).not.toHaveBeenCalled();
    expect(deps.mainExecute).not.toHaveBeenCalled();
  });
});