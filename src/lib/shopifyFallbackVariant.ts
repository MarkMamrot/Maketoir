import { randomUUID } from 'crypto';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

const SETTING_KEY = 'shopify_fallback_variant_id';
const FALLBACK_SKU = 'SHOPIFY-MISC';
const LOCK_PREFIX = 'shopify_fallback';

export const SHOPIFY_FALLBACK_SKU = FALLBACK_SKU;

function lockKeyForBusiness(businessId: string): string {
  return `${LOCK_PREFIX}:${businessId}`;
}

async function getSetting(businessId: string, key: string): Promise<string | null> {
  const rows = await imsQuery<{ value: string }>(
    'SELECT value FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1',
    [businessId, key],
  );
  return rows[0]?.value ?? null;
}

async function setSetting(businessId: string, key: string, value: string): Promise<void> {
  await imsExecute(
    'INSERT INTO ims_settings (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [businessId, key, value],
  );
}

async function findVariantById(businessId: string, variantId: string): Promise<string | null> {
  const rows = await imsQuery<{ variant_id: string }>(
    `SELECT v.variant_id
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
      WHERE p.business_id = ? AND v.variant_id = ?
      LIMIT 1`,
    [businessId, variantId],
  );
  return rows[0]?.variant_id ?? null;
}

async function findVariantBySku(businessId: string, sku: string): Promise<string | null> {
  const rows = await imsQuery<{ variant_id: string }>(
    `SELECT v.variant_id
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
      WHERE p.business_id = ? AND v.sku = ?
      ORDER BY v.id ASC
      LIMIT 1`,
    [businessId, sku],
  );
  return rows[0]?.variant_id ?? null;
}

async function findFallbackProductIdBySku(businessId: string, sku: string): Promise<string | null> {
  const rows = await imsQuery<{ product_id: string }>(
    `SELECT product_id
       FROM ims_products
      WHERE business_id = ? AND LOWER(COALESCE(base_sku, '')) = LOWER(?)
      ORDER BY id ASC
      LIMIT 1`,
    [businessId, sku],
  );
  return rows[0]?.product_id ?? null;
}

async function insertFallbackVariant(businessId: string, productId: string, variantId: string): Promise<void> {
  await imsExecute(
    `INSERT INTO ims_product_variants
       (business_id, variant_id, product_id, sku, option1_name, option1_value, cost_aud, price_rrp, price_wholesale, is_active)
     VALUES (?, ?, ?, ?, 'Type', 'Fallback', 0, 0, 0, 1)`,
    [businessId, variantId, productId, FALLBACK_SKU],
  );
}

async function acquireNamedLock(lockKey: string, timeoutSeconds = 10): Promise<boolean> {
  const rows = await imsQuery<Array<{ got_lock: number }>[number]>(
    'SELECT GET_LOCK(?, ?) AS got_lock',
    [lockKey, timeoutSeconds],
  );
  return Number(rows[0]?.got_lock ?? 0) === 1;
}

async function releaseNamedLock(lockKey: string): Promise<void> {
  await imsQuery('SELECT RELEASE_LOCK(?) AS released', [lockKey]).catch(() => {});
}

export async function isShopifyFallbackProduct(productId: string, businessId: string): Promise<boolean> {
  const rows = await imsQuery<{ is_fallback: number }>(
    `SELECT CASE
        WHEN EXISTS (
          SELECT 1
          FROM ims_products p
          WHERE p.business_id = ? AND p.product_id = ? AND LOWER(COALESCE(p.base_sku, '')) = LOWER(?)
        ) THEN 1
        ELSE 0
      END AS is_fallback`,
    [businessId, productId, FALLBACK_SKU],
  );
  return Number(rows[0]?.is_fallback ?? 0) === 1;
}

export async function isShopifyFallbackVariant(variantId: string, businessId: string): Promise<boolean> {
  const rows = await imsQuery<{ is_fallback: number }>(
    `SELECT CASE
        WHEN EXISTS (
          SELECT 1
          FROM ims_product_variants v
          JOIN ims_products p ON p.product_id = v.product_id
          WHERE p.business_id = ? AND v.variant_id = ? AND LOWER(COALESCE(v.sku, '')) = LOWER(?)
        ) THEN 1
        ELSE 0
      END AS is_fallback`,
    [businessId, variantId, FALLBACK_SKU],
  );
  return Number(rows[0]?.is_fallback ?? 0) === 1;
}

export function isReservedShopifyFallbackSku(sku: unknown): boolean {
  if (typeof sku !== 'string') return false;
  return sku.trim().toUpperCase() === FALLBACK_SKU;
}

export async function getOrCreateShopifyFallbackVariantId(businessId: string): Promise<string> {
  const lockKey = lockKeyForBusiness(businessId);
  const locked = await acquireNamedLock(lockKey, 10);
  if (!locked) {
    throw new Error('Failed to acquire Shopify fallback lock');
  }

  try {
    // Re-check inside the lock to prevent duplicate creations across concurrent
    // webhooks/import workers.
    const configuredVariant = await getSetting(businessId, SETTING_KEY);
    if (configuredVariant) {
      const existing = await findVariantById(businessId, configuredVariant);
      if (existing) return existing;
    }

    const existingBySku = await findVariantBySku(businessId, FALLBACK_SKU);
    if (existingBySku) {
      await setSetting(businessId, SETTING_KEY, existingBySku);
      return existingBySku;
    }

    const existingProductId = await findFallbackProductIdBySku(businessId, FALLBACK_SKU);
    if (existingProductId) {
      const variantId = randomUUID();
      await insertFallbackVariant(businessId, existingProductId, variantId);
      await setSetting(businessId, SETTING_KEY, variantId);
      return variantId;
    }

    const productId = randomUUID();
    const variantId = randomUUID();

    await imsExecute(
      `INSERT INTO ims_products
         (business_id, product_id, name, description, product_type, category, base_sku, is_online, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [
        businessId,
        productId,
        'Shopify Misc Charge',
        'Fallback product for Shopify order lines without a matched IMS variant.',
        'service',
        'Shopify Fallback',
        FALLBACK_SKU,
      ],
    );

    await insertFallbackVariant(businessId, productId, variantId);

    await setSetting(businessId, SETTING_KEY, variantId);
    return variantId;
  } finally {
    await releaseNamedLock(lockKey);
  }
}
