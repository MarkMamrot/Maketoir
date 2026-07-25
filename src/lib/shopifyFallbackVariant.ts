import { randomUUID } from 'crypto';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

const SETTING_KEY = 'shopify_fallback_variant_id';
const FALLBACK_SKU = 'SHOPIFY-MISC';

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

export async function getOrCreateShopifyFallbackVariantId(businessId: string): Promise<string> {
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

  await imsExecute(
    `INSERT INTO ims_product_variants
       (business_id, variant_id, product_id, sku, option1_name, option1_value, cost, price, is_active)
     VALUES (?, ?, ?, ?, 'Type', 'Fallback', 0, 0, 1)`,
    [businessId, variantId, productId, FALLBACK_SKU],
  );

  await setSetting(businessId, SETTING_KEY, variantId);
  return variantId;
}
