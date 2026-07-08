/**
 * IMS → Shopify inventory sync.
 *
 * The online store's available quantity = SUM over the configured Online Pick
 * Location(s) of GREATEST(0, qty_on_hand - qty_committed). This is pushed to
 * Shopify as an absolute "available" level (set, not adjust) so it self-corrects
 * and never double-counts against Shopify's own order decrements.
 *
 * A DB trigger on ims_stock_movements queues every touched variant into
 * ims_shopify_inventory_queue; drainInventoryQueue() processes that queue.
 */
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getSetting(businessId: string, key: string): Promise<string> {
  const rows = await imsQuery<{ value: string }>(
    `SELECT value FROM ims_settings WHERE business_id = ? AND \`key\` = ? LIMIT 1`,
    [businessId, key],
  );
  return rows[0]?.value ?? '';
}

/** Online pick location ids (priority list, else the single online sales location). */
export async function getOnlinePickLocationIds(businessId: string): Promise<number[]> {
  const pri = await getSetting(businessId, 'online_pick_priority');
  try {
    const arr = JSON.parse(pri || '[]');
    if (Array.isArray(arr) && arr.length) return arr.map(Number).filter(Boolean);
  } catch {}
  const single = Number(await getSetting(businessId, 'online_sales_location_id') || 0);
  return single ? [single] : [];
}

/** Build a Shopify service for a business, or null if not connected. */
export async function getShopifyForBusiness(businessId: string): Promise<ShopifyService | null> {
  const conn = await ConnectionsRepository.get(businessId) as any;
  const rawShopId = conn?.shopify_shop_id ?? '';
  const encToken  = conn?.shopify_access_token ?? '';
  if (!rawShopId || !encToken) return null;
  const shopName = rawShopId.replace(/\.myshopify\.com$/, '');
  if (!/^[a-zA-Z0-9-]+$/.test(shopName)) return null;
  return new ShopifyService(shopName, decrypt(encToken));
}

/** Resolve the Shopify location used for online inventory.
 *  Infers it from an existing inventory level (write_inventory scope only).
 *  Caches the result in ims_settings so subsequent calls are instant.
 */
export async function getShopifyInventoryLocationId(businessId: string, shopify: ShopifyService): Promise<number | null> {
  // Use cached value if present.
  const cached = Number(await getSetting(businessId, 'shopify_inventory_location_id') || 0);
  if (cached) return cached;

  // Discover from the first linked variant's existing inventory level.
  // This only needs write_inventory scope — no read_locations required.
  try {
    const rows = await imsQuery<{ shopify_inventory_item_id: string }>(
      `SELECT v.shopify_inventory_item_id
         FROM ims_product_variants v JOIN ims_products p ON p.product_id = v.product_id
        WHERE p.business_id = ? AND v.shopify_inventory_item_id IS NOT NULL AND v.shopify_inventory_item_id <> ''
        LIMIT 1`,
      [businessId],
    );
    if (rows[0]?.shopify_inventory_item_id) {
      const locationIds = await shopify.getInventoryLocationsForItem(rows[0].shopify_inventory_item_id);
      if (locationIds.length) {
        // Cache so we don't re-discover on every push.
        await imsExecute(
          `INSERT INTO ims_settings (business_id, \`key\`, value) VALUES (?, 'shopify_inventory_location_id', ?)
             ON DUPLICATE KEY UPDATE value = VALUES(value)`,
          [businessId, String(locationIds[0])],
        );
        return locationIds[0];
      }
    }
  } catch {}
  return null;
}

/** Available-to-sell per variant across the counting locations, minus optional buffer. */
async function computeAvailable(
  pickLocationIds: number[],
  variantIds: string[],
  buffer = 0,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!pickLocationIds.length || !variantIds.length) return map;
  const locPh = pickLocationIds.map(() => '?').join(',');
  const varPh = variantIds.map(() => '?').join(',');
  const rows = await imsQuery<{ variant_id: string; available: number }>(
    `SELECT variant_id, SUM(GREATEST(0, qty_on_hand - qty_committed)) AS available
       FROM ims_stock
      WHERE location_id IN (${locPh}) AND variant_id IN (${varPh})
      GROUP BY variant_id`,
    [...pickLocationIds, ...variantIds],
  );
  const buf = Math.max(0, Math.floor(buffer));
  for (const r of rows) map.set(r.variant_id, Math.max(0, Number(r.available ?? 0) - buf));
  return map;
}

export interface PushResult { pushed: number; skipped: number; errors: string[]; locationId: number | null }

/**
 * Push inventory for a business. Pass explicit variantIds, or all=true to push
 * every Shopify-linked variant (initial reconcile). Respects the
 * shopify_inventory_sync_enabled setting unless force=true.
 */
export async function pushInventoryForBusiness(
  businessId: string,
  opts: { variantIds?: string[]; all?: boolean; force?: boolean } = {},
): Promise<PushResult> {
  const result: PushResult = { pushed: 0, skipped: 0, errors: [], locationId: null };

  const enabled = (await getSetting(businessId, 'shopify_inventory_sync_enabled')) === '1';
  if (!enabled && !opts.force) { result.errors.push('Inventory sync disabled'); return result; }

  const shopify = await getShopifyForBusiness(businessId);
  if (!shopify) { result.errors.push('Shopify not connected'); return result; }

  const pickLocs = await getOnlinePickLocationIds(businessId);
  if (!pickLocs.length) { result.errors.push('No stock counting locations configured'); return result; }

  const buffer = Math.max(0, parseInt(await getSetting(businessId, 'shopify_inventory_buffer') || '0', 10));

  // Use a pre-resolved location if passed (avoids an extra API call that needs read_locations scope).
  const shopifyLocationId = await getShopifyInventoryLocationId(businessId, shopify);
  if (!shopifyLocationId) { result.errors.push('No Shopify inventory location'); return result; }
  result.locationId = shopifyLocationId;

  // Resolve the variants to push (must be Shopify-linked with an inventory_item_id)
  let linkRows: { variant_id: string; shopify_inventory_item_id: string }[];
  if (opts.all) {
    linkRows = await imsQuery(
      `SELECT v.variant_id, v.shopify_inventory_item_id
         FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
        WHERE p.business_id = ? AND v.shopify_inventory_item_id IS NOT NULL AND v.shopify_inventory_item_id <> ''`,
      [businessId],
    );
  } else {
    const ids = opts.variantIds ?? [];
    if (!ids.length) return result;
    const ph = ids.map(() => '?').join(',');
    linkRows = await imsQuery(
      `SELECT v.variant_id, v.shopify_inventory_item_id
         FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
        WHERE p.business_id = ? AND v.variant_id IN (${ph})
          AND v.shopify_inventory_item_id IS NOT NULL AND v.shopify_inventory_item_id <> ''`,
      [businessId, ...ids],
    );
  }
  if (!linkRows.length) return result;

  const availByVariant = await computeAvailable(pickLocs, linkRows.map(r => r.variant_id), buffer);

  // Push in bulk GraphQL batches (up to 250 inventory items per API call).
  // This replaces the old one-REST-call-per-variant loop, which was ~600ms per
  // variant and hit proxy timeouts. A 250-item batch is a single round-trip.
  const BULK = 250;
  for (let i = 0; i < linkRows.length; i += BULK) {
    const chunk = linkRows.slice(i, i + BULK);
    const items = chunk.map(row => ({
      inventoryItemId: row.shopify_inventory_item_id,
      available: availByVariant.get(row.variant_id) ?? 0,
    }));
    try {
      const { userErrors } = await shopify.setInventoryLevelsBulk(items, shopifyLocationId);
      if (userErrors.length) {
        // Scope/permission problems surface here as user errors — same for the
        // whole batch, so bail out with a clear message rather than repeating.
        const joined = userErrors.map(e => e.message).join('; ');
        if (/write_inventory|forbidden|access|scope|permission/i.test(joined)) {
          result.errors.push('Shopify token is missing the "write_inventory" scope. Add it to your Shopify custom app (Configuration → Admin API access scopes), reinstall the app, and paste the new access token into Setup → Connections.');
          result.skipped += linkRows.length - result.pushed;
          return result;
        }
        result.errors.push(joined);
        result.skipped += chunk.length;
      } else {
        result.pushed += chunk.length;
      }
    } catch (e: any) {
      const msg = e?.message ?? 'bulk push failed';
      if (/403|forbidden|write_inventory|access denied/i.test(msg)) {
        result.errors.push('Shopify token is missing the "write_inventory" scope. Add it to your Shopify custom app (Configuration → Admin API access scopes), reinstall the app, and paste the new access token into Setup → Connections.');
        result.skipped += linkRows.length - result.pushed;
        return result;
      }
      result.errors.push(`batch @${i}: ${msg}`);
      result.skipped += chunk.length;
    }
    await sleep(250); // gentle pacing between GraphQL calls
  }
  return result;
}

/**
 * Drain the dirty-variant queue across all businesses. Processes up to `limit`
 * variants. Variants that can't be pushed (no Shopify link, business not
 * connected, sync disabled) are removed from the queue so it doesn't back up.
 */
export async function drainInventoryQueue(limit = 250): Promise<{ processed: number; pushed: number; businesses: number; errors: string[] }> {
  const queued = await imsQuery<{ variant_id: string; business_id: string; inv: string | null }>(
    `SELECT q.variant_id, p.business_id, v.shopify_inventory_item_id AS inv
       FROM ims_shopify_inventory_queue q
       JOIN ims_product_variants v ON v.variant_id = q.variant_id
       JOIN ims_products p ON p.product_id = v.product_id
      ORDER BY q.queued_at ASC
      LIMIT ?`,
    [limit],
  );
  if (!queued.length) return { processed: 0, pushed: 0, businesses: 0 };

  // Group by business
  const byBiz = new Map<string, string[]>();
  const allVariantIds: string[] = [];
  for (const q of queued) {
    allVariantIds.push(q.variant_id);
    if (!q.inv) continue; // not linked — will just be cleared
    if (!byBiz.has(q.business_id)) byBiz.set(q.business_id, []);
    byBiz.get(q.business_id)!.push(q.variant_id);
  }

  let pushed = 0;
  const drainErrors: string[] = [];
  for (const [businessId, variantIds] of byBiz) {
    try {
      // force:true so queued items always push regardless of the 'enabled' toggle.
      const res = await pushInventoryForBusiness(businessId, { variantIds, force: true });
      pushed += res.pushed;
      if (res.errors.length) drainErrors.push(...res.errors.slice(0, 3));
    } catch (e: any) {
      console.error('[inventory-sync] business', businessId, e?.message);
      drainErrors.push(e?.message ?? 'unknown error');
    }
  }

  // Delete processed variants from the queue in chunks (avoids huge IN() clauses).
  const DEL_CHUNK = 500;
  for (let i = 0; i < allVariantIds.length; i += DEL_CHUNK) {
    const chunk = allVariantIds.slice(i, i + DEL_CHUNK);
    const ph = chunk.map(() => '?').join(',');
    await imsExecute(
      `DELETE FROM ims_shopify_inventory_queue WHERE variant_id IN (${ph})`,
      chunk,
    ).catch(err => console.error('[inventory-sync] delete chunk error:', err?.message));
  }

  return { processed: queued.length, pushed, businesses: byBiz.size, errors: drainErrors };
}
