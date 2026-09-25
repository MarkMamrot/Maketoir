import crypto from 'node:crypto';

import { decrypt } from '@/lib/encryption';
import { assertShopifyEnabled } from '@/lib/ims/businessOperations';
import { normalizeShopifyShopDomain } from '@/lib/shopifyCredentials';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';

type ShopifyWebhookRow = {
  business_id: string;
  channel_instance_id: string;
  external_account_key: string | null;
  is_enabled: number;
  runtime_status: string;
  readiness_status: string;
  encrypted_secret: string | null;
  registration_status: string;
};

export type VerifiedShopifyWebhook = {
  businessId: string;
  channelInstanceId: string;
  topic: string;
  webhookId: string;
  shopDomain: string;
  payloadHash: string;
};

export class ShopifyWebhookIngressError extends Error {
  constructor(
    readonly code: 'invalid_headers' | 'registration_not_found' | 'registration_inactive'
      | 'instance_inactive' | 'instance_not_ready' | 'domain_mismatch' | 'invalid_signature'
      | 'secret_unavailable',
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ShopifyWebhookIngressError';
  }
}

function signaturesMatch(rawBody: string, signature: string, secret: string): boolean {
  const computed = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const expected = Buffer.from(computed);
  const received = Buffer.from(signature);
  return signature.length > 0 && expected.length === received.length
    && crypto.timingSafeEqual(expected, received);
}

export async function verifyShopifyWebhook(input: {
  channelInstanceId: string;
  rawBody: string;
  topic: string | null;
  webhookId: string | null;
  shopDomain: string | null;
  hmac: string | null;
}): Promise<VerifiedShopifyWebhook> {
  const channelInstanceId = input.channelInstanceId.trim();
  const topic = input.topic?.trim().toLowerCase() ?? '';
  const webhookId = input.webhookId?.trim() ?? '';
  const shopDomain = normalizeShopifyShopDomain(input.shopDomain ?? '');
  const hmac = input.hmac?.trim() ?? '';
  if (!channelInstanceId || !topic || !webhookId || !shopDomain || !hmac) {
    throw new ShopifyWebhookIngressError('invalid_headers', 400, 'Required Shopify webhook headers are missing.');
  }

  const rows = await query<ShopifyWebhookRow>(
    `SELECT instance.business_id, instance.channel_instance_id, instance.external_account_key,
            instance.is_enabled, instance.runtime_status, instance.readiness_status,
            webhook.encrypted_secret, webhook.registration_status
       FROM sales_channel_instances instance
       JOIN sales_channel_webhooks webhook
         ON webhook.channel_instance_id = instance.channel_instance_id AND webhook.topic = ?
      WHERE instance.channel_instance_id = ? AND instance.provider = 'shopify'
      LIMIT 1`,
    [topic, channelInstanceId],
  );
  const row = rows[0];
  if (!row) throw new ShopifyWebhookIngressError('registration_not_found', 404, 'Shopify webhook registration was not found.');
  await assertShopifyEnabled(row.business_id);
  if (row.registration_status !== 'registered') {
    throw new ShopifyWebhookIngressError('registration_inactive', 409, 'Shopify webhook registration is not active.');
  }
  if (row.is_enabled !== 1 || row.runtime_status !== 'active') {
    throw new ShopifyWebhookIngressError('instance_inactive', 409, 'Shopify channel instance is not active.');
  }
  if (row.readiness_status !== 'ready') {
    throw new ShopifyWebhookIngressError('instance_not_ready', 409, 'Shopify channel instance is not ready.');
  }
  if (normalizeShopifyShopDomain(row.external_account_key ?? '') !== shopDomain) {
    throw new ShopifyWebhookIngressError('domain_mismatch', 401, 'Shopify webhook domain does not match this channel instance.');
  }

  let secret: string;
  try {
    secret = decrypt(row.encrypted_secret ?? '').trim();
  } catch {
    throw new ShopifyWebhookIngressError('secret_unavailable', 409, 'Shopify webhook secret must be reconfigured.');
  }
  if (!secret) throw new ShopifyWebhookIngressError('secret_unavailable', 409, 'Shopify webhook secret is not configured.');
  if (!signaturesMatch(input.rawBody, hmac, secret)) {
    throw new ShopifyWebhookIngressError('invalid_signature', 401, 'Invalid Shopify webhook signature.');
  }

  return {
    businessId: row.business_id,
    channelInstanceId: row.channel_instance_id,
    topic,
    webhookId,
    shopDomain,
    payloadHash: crypto.createHash('sha256').update(input.rawBody, 'utf8').digest('hex'),
  };
}

export async function stageShopifyWebhookEvent(webhook: VerifiedShopifyWebhook): Promise<'pending' | 'duplicate'> {
  await imsExecute(
    `INSERT INTO ims_sales_channel_events
       (business_id, channel_instance_id, provider, event_type, external_event_id, payload_json)
     VALUES (?, ?, 'shopify', ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [webhook.businessId, webhook.channelInstanceId, webhook.topic, webhook.webhookId,
      JSON.stringify({ shopDomain: webhook.shopDomain, payloadSha256: webhook.payloadHash })],
  );
  const rows = await imsQuery<{ status: string; attempts: number }>(
    `SELECT status, attempts FROM ims_sales_channel_events
      WHERE business_id = ? AND channel_instance_id = ? AND external_event_id = ? LIMIT 1`,
    [webhook.businessId, webhook.channelInstanceId, webhook.webhookId],
  );
  return rows[0] && (rows[0].status !== 'pending' || Number(rows[0].attempts) > 0) ? 'duplicate' : 'pending';
}

export async function claimShopifyWebhookEvent(webhook: VerifiedShopifyWebhook): Promise<boolean> {
  const result = await imsExecute(
    `UPDATE ims_sales_channel_events
        SET status = 'processing', attempts = attempts + 1, safe_error = NULL, processed_at = NULL
      WHERE business_id = ? AND channel_instance_id = ? AND external_event_id = ?
        AND status IN ('pending','failed') AND attempts < 5`,
    [webhook.businessId, webhook.channelInstanceId, webhook.webhookId],
  );
  return Number(result.affectedRows ?? 0) === 1;
}

export async function finishShopifyWebhookEvent(input: {
  webhook: VerifiedShopifyWebhook;
  status: 'complete' | 'failed' | 'ignored';
  safeError?: string | null;
}): Promise<void> {
  await imsExecute(
    `UPDATE ims_sales_channel_events
        SET status = ?, processed_at = CURRENT_TIMESTAMP(3), safe_error = ?
      WHERE business_id = ? AND channel_instance_id = ? AND external_event_id = ? AND status = 'processing'`,
    [input.status, input.status === 'failed' ? String(input.safeError ?? 'Webhook processing failed.').slice(0, 500) : null,
      input.webhook.businessId, input.webhook.channelInstanceId, input.webhook.webhookId],
  );
}