import { NextResponse } from 'next/server';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';

// Settings whose changes affect the inventory qty pushed to Shopify.
// When any of these keys change we must re-enqueue every linked variant so the
// next cron run re-syncs them with the new buffer / new pick-location set.
const INVENTORY_SENSITIVE_KEYS = new Set([
  'shopify_inventory_buffer',
  'online_pick_priority',
]);

/** GET /api/ims/settings — returns all settings for the business as { key: value } */
export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId;
  try {
    const rows = await imsQuery<{ key: string; value: string }>(
      'SELECT `key`, `value` FROM ims_settings WHERE business_id = ?',
      [businessId]
    );
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key] = row.value ?? '';
    // Include Shopify shop domain so client can build admin links without a separate fetch
    const conn = await ConnectionsRepository.get(businessId);
    const shopDomain: string = conn?.shopify_shop_id ?? '';
    return NextResponse.json({ success: true, data: settings, shopDomain });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * PUT /api/ims/settings — upserts one or more key/value pairs.
 * Body: { key: string, value: string } or { settings: Record<string, string> }
 */
export async function PUT(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId;
  try {
    const body = await req.json();
    // Accept either { key, value } or { settings: { key: value, ... } }
    const pairs: Record<string, string> =
      body.settings ?? (body.key !== undefined ? { [body.key]: body.value } : body);

    for (const [key, value] of Object.entries(pairs)) {
      await imsExecute(
        'INSERT INTO ims_settings (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [businessId, key, value ?? null]
      );
    }

    // If any inventory-sync setting changed, re-enqueue all Shopify-linked variants
    // so the next cron run applies the new buffer / pick-locations immediately.
    const inventoryAffected = Object.keys(pairs).some(k => INVENTORY_SENSITIVE_KEYS.has(k));
    if (inventoryAffected) {
      await imsExecute(
        `INSERT IGNORE INTO ims_shopify_inventory_queue (variant_id, queued_at)
         SELECT v.variant_id, NOW()
           FROM ims_product_variants v
           JOIN ims_products p ON p.product_id = v.product_id
          WHERE p.business_id = ?
            AND v.shopify_inventory_item_id IS NOT NULL
            AND v.shopify_inventory_item_id <> ''`,
        [businessId],
      );
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
