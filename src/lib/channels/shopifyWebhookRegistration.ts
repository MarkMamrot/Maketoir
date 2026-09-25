import { encrypt } from '@/lib/encryption';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { getShopifyChannelWebhookSigningSecret } from '@/lib/shopifyCredentials';
import { execute, query } from '@/services/MySQLService';

export const SHOPIFY_EXACT_WEBHOOK_TOPICS = [
  'orders/create',
  'orders/paid',
  'orders/updated',
  'orders/cancelled',
  'fulfillments/create',
  'fulfillments/update',
  'orders/fulfilled',
  'refunds/create',
  'returns/update',
  'shopify_payments/payouts/create',
  'shopify_payments/payouts/update',
] as const;

const OPTIONAL_TOPICS = new Set<string>([
  'returns/update',
  'shopify_payments/payouts/create',
  'shopify_payments/payouts/update',
]);

type ShopifyWebhook = { id: number | string; topic: string; address: string };

type Dependencies = {
  fetchImpl: typeof fetch;
  mainQuery: typeof query;
  mainExecute: typeof execute;
  loadContext: typeof getShopifyOperationContext;
  loadCredentialSecret: typeof getShopifyChannelWebhookSigningSecret;
  encryptSecret: typeof encrypt;
};

const defaults: Dependencies = {
  fetchImpl: fetch,
  mainQuery: query,
  mainExecute: execute,
  loadContext: getShopifyOperationContext,
  loadCredentialSecret: getShopifyChannelWebhookSigningSecret,
  encryptSecret: encrypt,
};

async function providerRequest(
  dependencies: Dependencies,
  endpoint: string,
  token: string,
  init?: RequestInit,
): Promise<any> {
  const response = await dependencies.fetchImpl(endpoint, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token, ...init?.headers },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Shopify webhook request failed with HTTP ${response.status}.`);
  return payload;
}

export async function reconcileShopifyWebhooks(input: {
  businessId: string;
  channelInstanceId: string;
  callbackUrl: string;
  signingSecret?: string | null;
}, dependencies: Dependencies = defaults): Promise<{
  registered: number;
  updated: number;
  topics: string[];
  failed: Array<{ topic: string; error: string; optional: boolean }>;
}> {
  const context = await dependencies.loadContext({
    businessId: input.businessId,
    channelInstanceId: input.channelInstanceId,
  });
  const callbackUrl = input.callbackUrl.trim();
  if (!/^https:\/\//i.test(callbackUrl)) throw new Error('Shopify webhook callback URL must use HTTPS.');
  const existingRows = await dependencies.mainQuery<{ encrypted_secret: string | null }>(
    `SELECT encrypted_secret FROM sales_channel_webhooks
      WHERE channel_instance_id = ? AND encrypted_secret IS NOT NULL LIMIT 1`,
    [input.channelInstanceId],
  );
  const explicitSecret = input.signingSecret?.trim() ?? '';
  const credentialSecret = await dependencies.loadCredentialSecret(input.businessId, input.channelInstanceId);
  const encryptedSecret = explicitSecret
    ? dependencies.encryptSecret(explicitSecret)
    : credentialSecret ? dependencies.encryptSecret(credentialSecret) : existingRows[0]?.encrypted_secret ?? null;
  if (!encryptedSecret) {
    throw new Error('Enter the Shopify webhook signing secret for this storefront before registration.');
  }

  const base = `https://${context.credentials.shopDomain}/admin/api/2025-10`;
  const listed = await providerRequest(dependencies, `${base}/webhooks.json?limit=250`, context.credentials.token);
  const webhooks = (Array.isArray(listed?.webhooks) ? listed.webhooks : []) as ShopifyWebhook[];
  let registered = 0;
  let updated = 0;
  const failed: Array<{ topic: string; error: string; optional: boolean }> = [];
  for (const topic of SHOPIFY_EXACT_WEBHOOK_TOPICS) {
    try {
      const matching = webhooks.find(webhook => webhook.topic === topic);
      let registrationId: string;
      if (!matching) {
        const created = await providerRequest(dependencies, `${base}/webhooks.json`, context.credentials.token, {
          method: 'POST', body: JSON.stringify({ webhook: { topic, address: callbackUrl, format: 'json' } }),
        });
        registrationId = String(created?.webhook?.id ?? '');
        registered += 1;
      } else if (matching.address !== callbackUrl) {
        const changed = await providerRequest(dependencies, `${base}/webhooks/${matching.id}.json`, context.credentials.token, {
          method: 'PUT', body: JSON.stringify({ webhook: { id: matching.id, address: callbackUrl, format: 'json' } }),
        });
        registrationId = String(changed?.webhook?.id ?? matching.id);
        updated += 1;
      } else {
        registrationId = String(matching.id);
      }
      if (!registrationId) throw new Error(`Shopify did not return a registration ID for ${topic}.`);
      await dependencies.mainExecute(
        `INSERT INTO sales_channel_webhooks
           (channel_instance_id, topic, provider_registration_id, encrypted_secret,
            registration_status, last_verified_at, safe_error)
         VALUES (?, ?, ?, ?, 'registered', CURRENT_TIMESTAMP(3), NULL)
         ON DUPLICATE KEY UPDATE provider_registration_id = VALUES(provider_registration_id),
           encrypted_secret = VALUES(encrypted_secret), registration_status = 'registered',
           last_verified_at = CURRENT_TIMESTAMP(3), safe_error = NULL`,
        [input.channelInstanceId, topic, registrationId, encryptedSecret],
      );
    } catch (error) {
      const safeError = error instanceof Error ? error.message.slice(0, 1000) : 'Shopify webhook registration failed.';
      await dependencies.mainExecute(
        `INSERT INTO sales_channel_webhooks
           (channel_instance_id, topic, encrypted_secret, registration_status, safe_error)
         VALUES (?, ?, ?, 'failed', ?)
         ON DUPLICATE KEY UPDATE encrypted_secret = VALUES(encrypted_secret),
           registration_status = 'failed', safe_error = VALUES(safe_error)`,
        [input.channelInstanceId, topic, encryptedSecret, safeError],
      );
      failed.push({ topic, error: safeError, optional: OPTIONAL_TOPICS.has(topic) });
    }
  }
  const coreFailures = failed.filter(failure => !failure.optional);
  if (coreFailures.length > 0) {
    throw new Error(`Required Shopify webhooks failed: ${coreFailures.map(failure => failure.topic).join(', ')}.`);
  }
  return { registered, updated, topics: [...SHOPIFY_EXACT_WEBHOOK_TOPICS], failed };
}