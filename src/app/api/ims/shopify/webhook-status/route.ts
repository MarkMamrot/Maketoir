/**
 * /api/ims/shopify/webhook-status
 *
 * GET  — compare required webhooks against what's registered via the API.
 *        Note: webhooks created through the Shopify Admin UI are NOT visible
 *        to this endpoint (Shopify limitation). Use POST to register them
 *        via the API instead, which is the recommended approach.
 *
 * POST — register / update all required webhooks via the Shopify Admin API.
 *        Idempotent: creates missing ones, updates wrong-URL ones, leaves
 *        correct ones untouched. Returns per-topic result.
 *
 * Auth: authenticated IMS session.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';

export const runtime = 'nodejs';
export const maxDuration = 60;

const REQUIRED_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'fulfillments/create',
  'refunds/create',
];

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

function buildExpectedUrl(req: Request, businessId: string): string {
  const fwHost = req.headers.get('x-forwarded-host');
  const origin = fwHost
    ? `https://${fwHost.split(',')[0].trim()}`  // take first if comma-separated
    : new URL(req.url).origin;
  return `${origin}/api/webhooks/shopify/orders/${businessId}`;
}

async function getShopifyCreds(businessId: string) {
  const conn = await ConnectionsRepository.get(businessId) as any;
  const rawShopId = conn?.shopify_shop_id ?? '';
  const encToken  = conn?.shopify_access_token ?? '';
  if (!rawShopId || !encToken) return null;
  const shopName = String(rawShopId).replace(/\.myshopify\.com$/, '');
  const token = decrypt(encToken);
  return { shopName, token, base: `https://${shopName}.myshopify.com/admin/api/2024-10` };
}

async function listApiWebhooks(base: string, token: string) {
  const res = await fetch(`${base}/webhooks.json?limit=250`, {
    headers: { 'X-Shopify-Access-Token': token },
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { webhooks } = await res.json();
  return (webhooks ?? []) as any[];
}

export async function GET(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;

  const settings = await imsQuery<{ key: string; value: string }>(
    `SELECT \`key\`, value FROM ims_settings WHERE business_id = ?
       AND \`key\` IN ('shopify_webhook_secret','shopify_order_sync_enabled')`,
    [businessId],
  ).catch(() => [] as { key: string; value: string }[]);
  const get = (k: string) => settings.find(s => s.key === k)?.value ?? '';
  const hasSecret = !!get('shopify_webhook_secret');
  const syncEnabled = get('shopify_order_sync_enabled') === '1';

  const expectedUrl = buildExpectedUrl(req, businessId);
  const creds = await getShopifyCreds(businessId);
  if (!creds) return NextResponse.json({ success: false, error: 'Shopify not connected' });

  try {
    const webhooks = await listApiWebhooks(creds.base, creds.token);

    // Index by topic
    const byTopic = new Map<string, { id: number; address: string }[]>();
    for (const w of webhooks) {
      const t = String(w.topic);
      if (!byTopic.has(t)) byTopic.set(t, []);
      byTopic.get(t)!.push({ id: w.id, address: w.address });
    }

    const topics = REQUIRED_TOPICS.map(topic => {
      const registered = byTopic.get(topic) ?? [];
      const matched    = registered.filter(w => w.address === expectedUrl);
      const wrongUrl   = registered.filter(w => w.address !== expectedUrl);
      const status: 'ok' | 'wrong_url' | 'missing' =
        matched.length > 0 ? 'ok' : wrongUrl.length > 0 ? 'wrong_url' : 'missing';
      return { topic, status, registered };
    });

    const otherTopicsAtOurUrl: string[] = [];
    for (const [topic, entries] of byTopic.entries()) {
      if (!REQUIRED_TOPICS.includes(topic) && entries.some(e => e.address === expectedUrl)) {
        otherTopicsAtOurUrl.push(topic);
      }
    }

    const allOk = topics.every(t => t.status === 'ok');

    return NextResponse.json({
      success: true, hasSecret, syncEnabled, expectedUrl, topics,
      otherTopicsAtOurUrl, allRegisteredViaApi: webhooks.length, allOk,
      note: allOk ? null : 'UI-registered webhooks are invisible to this API check. Use "Register webhooks" to register them via the API instead.',
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;

  const expectedUrl = buildExpectedUrl(req, businessId);
  const creds = await getShopifyCreds(businessId);
  if (!creds) return NextResponse.json({ success: false, error: 'Shopify not connected' });

  try {
    const existing = await listApiWebhooks(creds.base, creds.token);

    // Build lookup: topic → first webhook that already points to our URL
    const byTopic = new Map<string, any>();
    for (const w of existing) byTopic.set(String(w.topic), w);

    const results: { topic: string; action: 'created' | 'updated' | 'ok' | 'error'; error?: string }[] = [];

    for (const topic of REQUIRED_TOPICS) {
      const current = byTopic.get(topic);
      try {
        if (!current) {
          // Create
          const r = await fetch(`${creds.base}/webhooks.json`, {
            method: 'POST',
            headers: { 'X-Shopify-Access-Token': creds.token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ webhook: { topic, address: expectedUrl, format: 'json' } }),
          });
          if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 150)}`);
          results.push({ topic, action: 'created' });
        } else if (current.address !== expectedUrl) {
          // Update URL
          const r = await fetch(`${creds.base}/webhooks/${current.id}.json`, {
            method: 'PUT',
            headers: { 'X-Shopify-Access-Token': creds.token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ webhook: { id: current.id, address: expectedUrl } }),
          });
          if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 150)}`);
          results.push({ topic, action: 'updated' });
        } else {
          results.push({ topic, action: 'ok' });
        }
      } catch (e: any) {
        results.push({ topic, action: 'error', error: e.message });
      }
    }

    return NextResponse.json({ success: true, results, expectedUrl });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}


export const runtime = 'nodejs';
export const maxDuration = 30;

const REQUIRED_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'fulfillments/create',
  'refunds/create',
];

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;

  // Load settings: secret + expected webhook URL base
  const settings = await imsQuery<{ key: string; value: string }>(
    `SELECT \`key\`, value FROM ims_settings WHERE business_id = ?
       AND \`key\` IN ('shopify_webhook_secret','shopify_order_sync_enabled')`,
    [businessId],
  ).catch(() => [] as { key: string; value: string }[]);
  const get = (k: string) => settings.find(s => s.key === k)?.value ?? '';

  const hasSecret = !!get('shopify_webhook_secret');
  const syncEnabled = get('shopify_order_sync_enabled') === '1';

  // Build the expected webhook address for this deployment
  const origin = req.headers.get('x-forwarded-host')
    ? `https://${req.headers.get('x-forwarded-host')}`
    : new URL(req.url).origin;
  const expectedUrl = `${origin}/api/webhooks/shopify/orders/${businessId}`;

  // Fetch Shopify connection
  const conn = await ConnectionsRepository.get(businessId) as any;
  const rawShopId = conn?.shopify_shop_id ?? '';
  const encToken = conn?.shopify_access_token ?? '';
  if (!rawShopId || !encToken) {
    return NextResponse.json({ success: false, error: 'Shopify not connected' });
  }
  const shopName = String(rawShopId).replace(/\.myshopify\.com$/, '');
  const token = decrypt(encToken);
  const base = `https://${shopName}.myshopify.com/admin/api/2024-10`;

  try {
    const res = await fetch(`${base}/webhooks.json?limit=250`, {
      headers: { 'X-Shopify-Access-Token': token },
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ success: false, error: `Shopify API ${res.status}: ${text.slice(0, 200)}` });
    }
    const { webhooks } = await res.json();

    // Index registered webhooks by topic (there can be multiple entries per topic)
    const byTopic = new Map<string, { id: number; address: string; updated_at: string }[]>();
    for (const w of (webhooks ?? [])) {
      const t = String(w.topic);
      if (!byTopic.has(t)) byTopic.set(t, []);
      byTopic.get(t)!.push({ id: w.id, address: w.address, updated_at: w.updated_at });
    }

    // Evaluate status for each required topic
    const topics = REQUIRED_TOPICS.map(topic => {
      const registered = byTopic.get(topic) ?? [];
      const matched = registered.filter(w => w.address === expectedUrl);
      const wrongUrl = registered.filter(w => w.address !== expectedUrl);
      let status: 'ok' | 'wrong_url' | 'missing';
      if (matched.length > 0) status = 'ok';
      else if (wrongUrl.length > 0) status = 'wrong_url';
      else status = 'missing';
      return { topic, status, registered };
    });

    // Also report any unexpected extra webhooks pointing to our URL
    const otherTopicsAtOurUrl: string[] = [];
    for (const [topic, entries] of byTopic.entries()) {
      if (!REQUIRED_TOPICS.includes(topic) && entries.some(e => e.address === expectedUrl)) {
        otherTopicsAtOurUrl.push(topic);
      }
    }

    return NextResponse.json({
      success: true,
      hasSecret,
      syncEnabled,
      expectedUrl,
      topics,
      otherTopicsAtOurUrl,
      allRegistered: (webhooks ?? []).length,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
