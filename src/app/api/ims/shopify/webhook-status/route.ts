/**
 * GET /api/ims/shopify/webhook-status
 *
 * Reads the webhooks currently registered in Shopify (via the Admin REST API)
 * and compares them against what IMS expects. Returns a per-topic status so
 * you can see at a glance whether everything is wired up correctly.
 *
 * Also checks that the signing secret is saved in IMS settings.
 *
 * Auth: authenticated IMS session.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';

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
