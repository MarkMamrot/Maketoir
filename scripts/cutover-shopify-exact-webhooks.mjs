import 'dotenv/config';
import { createDecipheriv } from 'node:crypto';
import mysql from 'mysql2/promise';

const requestedBusiness = process.argv.find(arg => arg.startsWith('--business='))?.slice(11).trim();
const origin = process.argv.find(arg => arg.startsWith('--origin='))?.slice(9).trim().replace(/\/+$/, '');
const apply = process.argv.includes('--apply');
if (!requestedBusiness || !origin) throw new Error('Usage: node scripts/cutover-shopify-exact-webhooks.mjs --business=<id-or-name> --origin=https://host [--apply]');
if (!/^https:\/\//i.test(origin)) throw new Error('Public origin must use HTTPS.');

const TOPICS = [
  'orders/create', 'orders/paid', 'orders/updated', 'orders/cancelled',
  'fulfillments/create', 'fulfillments/update', 'orders/fulfilled',
  'refunds/create', 'returns/update',
  'shopify_payments/payouts/create', 'shopify_payments/payouts/update',
];
const OPTIONAL = new Set(['returns/update', 'shopify_payments/payouts/create', 'shopify_payments/payouts/update']);

function key() {
  const value = process.env.ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('ENCRYPTION_KEY is invalid.');
  return Buffer.from(value, 'hex');
}

function decrypt(value) {
  const parts = String(value ?? '').split(':');
  if (parts.length !== 3) return String(value ?? '');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[0], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], 'hex')), decipher.final()]).toString('utf8');
}

async function shopifyRequest(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token, ...(init.headers ?? {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Shopify HTTP ${response.status}: ${payload?.errors ?? payload?.error ?? 'request failed'}`);
  return payload;
}

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

try {
  const [rows] = await connection.query(
    `SELECT business.business_id, business.name, instance.channel_instance_id,
            instance.external_account_key, instance.is_enabled, instance.runtime_status,
            instance.readiness_status, instance.settings_json, credential.encrypted_payload
       FROM businesses business
       JOIN sales_channel_instances instance
         ON BINARY instance.business_id = BINARY business.business_id AND instance.provider = 'shopify'
       JOIN sales_channel_credentials credential
         ON credential.channel_instance_id = instance.channel_instance_id
        AND credential.credential_type = 'shopify_admin_api'
      WHERE (BINARY business.business_id = BINARY ? OR LOWER(business.name) = LOWER(?))
        AND business.deleted_at IS NULL`,
    [requestedBusiness, requestedBusiness],
  );
  if (rows.length !== 1) throw new Error(`Expected one exact Shopify instance; found ${rows.length}.`);
  const row = rows[0];
  if (Number(row.is_enabled) !== 1 || row.runtime_status !== 'active' || row.readiness_status !== 'ready') throw new Error('Exact instance is not active and ready.');
  const settings = typeof row.settings_json === 'string' ? JSON.parse(row.settings_json || '{}') : row.settings_json ?? {};
  if (settings.productPublicationEnabled === true) throw new Error('Product publication must remain disabled.');
  if (settings?.shopify?.orders?.enabled !== true || !settings?.shopify?.orders?.locationId || !settings?.shopify?.orders?.syncFrom) throw new Error('Exact order settings are incomplete.');

  const envelope = JSON.parse(decrypt(row.encrypted_payload));
  const token = String(envelope.accessToken ?? '').trim();
  const shopDomain = String(envelope.shopDomain ?? row.external_account_key ?? '').trim();
  if (!token || !shopDomain) throw new Error('Exact Shopify credentials are incomplete.');

  const callbackUrl = `${origin}/api/webhooks/shopify/channels/${row.channel_instance_id}`;
  const legacyFragment = `/api/webhooks/shopify/orders/${row.business_id}`;
  const probe = await fetch(callbackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (probe.status !== 400) throw new Error(`Exact endpoint is not live: expected HTTP 400 for unsigned input, received ${probe.status}.`);

  const [secretRows] = await connection.query(
    'SELECT encrypted_secret FROM sales_channel_webhooks WHERE channel_instance_id = ? AND encrypted_secret IS NOT NULL LIMIT 1',
    [row.channel_instance_id],
  );
  if (!secretRows[0]) throw new Error('Prepared exact webhook signing secret is missing.');
  const encryptedSecret = secretRows[0].encrypted_secret;
  const base = `https://${shopDomain}/admin/api/2025-10`;
  const initial = await shopifyRequest(`${base}/webhooks.json?limit=250`, token);
  const existing = Array.isArray(initial.webhooks) ? initial.webhooks : [];
  const plan = [];
  const failures = [];

  for (const topic of TOPICS) {
    const current = existing.find(webhook => webhook.topic === topic && webhook.address === callbackUrl);
    plan.push({ topic, action: current ? 'keep' : 'create' });
    if (current || !apply) continue;
    try {
      const created = await shopifyRequest(`${base}/webhooks.json`, token, {
        method: 'POST',
        body: JSON.stringify({ webhook: { topic, address: callbackUrl, format: 'json' } }),
      });
      const id = String(created?.webhook?.id ?? '');
      if (!id) throw new Error('Shopify did not return a webhook ID.');
      await connection.query(
        `UPDATE sales_channel_webhooks SET provider_registration_id = ?, registration_status = 'registered',
                last_verified_at = CURRENT_TIMESTAMP(3), safe_error = NULL
          WHERE channel_instance_id = ? AND topic = ?`,
        [id, row.channel_instance_id, topic],
      );
    } catch (error) {
      failures.push({ topic, optional: OPTIONAL.has(topic), error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (apply) {
    const coreFailures = failures.filter(failure => !failure.optional);
    if (coreFailures.length) throw new Error(`Required exact webhooks failed: ${coreFailures.map(failure => failure.topic).join(', ')}.`);
    const verified = await shopifyRequest(`${base}/webhooks.json?limit=250`, token);
    const providerWebhooks = Array.isArray(verified.webhooks) ? verified.webhooks : [];
    const missingCore = TOPICS.filter(topic => !OPTIONAL.has(topic))
      .filter(topic => !providerWebhooks.some(webhook => webhook.topic === topic && webhook.address === callbackUrl));
    if (missingCore.length) throw new Error(`Exact webhook verification failed: ${missingCore.join(', ')}.`);

    const old = providerWebhooks.filter(webhook => String(webhook.address ?? '').includes(legacyFragment));
    for (const webhook of old) await shopifyRequest(`${base}/webhooks/${webhook.id}.json`, token, { method: 'DELETE' });
    const final = await shopifyRequest(`${base}/webhooks.json?limit=250`, token);
    if ((final.webhooks ?? []).some(webhook => String(webhook.address ?? '').includes(legacyFragment))) throw new Error('Legacy Shopify webhook registrations remain.');
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', business: row.name, channelInstanceId: row.channel_instance_id, callbackUrl, plan, failures }, null, 2));
} finally {
  await connection.end();
}
