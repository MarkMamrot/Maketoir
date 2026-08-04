import { imsQuery } from '@/services/IMSMySQLService';

export function getShopifyOrderCustomerId(order: unknown): string | null {
  if (!order || typeof order !== 'object') return null;
  const customer = (order as { customer?: unknown }).customer;
  if (!customer || typeof customer !== 'object') return null;
  const rawId = (customer as { id?: unknown }).id;
  const id = String(rawId ?? '').trim();
  return /^\d+$/.test(id) && id !== '0' ? id : null;
}

export async function resolveShopifyOrderCustomerId(
  businessId: string,
  order: unknown,
  fallbackCustomerId: number | null = null,
): Promise<number | null> {
  const shopifyCustomerId = getShopifyOrderCustomerId(order);
  if (!shopifyCustomerId) return fallbackCustomerId;

  const rows = await imsQuery<{ id: number }>(
    `SELECT id
       FROM ims_contacts
      WHERE business_id = ? AND shopify_customer_id = ?
      LIMIT 1`,
    [businessId, shopifyCustomerId],
  );
  return rows[0] ? Number(rows[0].id) : fallbackCustomerId;
}