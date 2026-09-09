import type { ShopifyAdminCredentials } from '@/lib/shopifyCredentials';

export async function testShopifyReadiness(
  credentials: ShopifyAdminCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`https://${credentials.shopDomain}/admin/api/2025-10/shop.json`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Shopify-Access-Token': credentials.token,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Shopify readiness check failed with HTTP ${response.status}.`);
  }
  const payload = await response.json().catch(() => null) as { shop?: { myshopify_domain?: string } } | null;
  const returnedDomain = String(payload?.shop?.myshopify_domain ?? '').trim().toLowerCase();
  if (!returnedDomain || returnedDomain !== credentials.shopDomain.toLowerCase()) {
    throw new Error('Shopify readiness check returned a different store identity.');
  }
}

export function shopifyReadinessFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/different store identity/i.test(message)) return 'Shopify returned a different store identity.';
  if (/HTTP 401|HTTP 403|access token|client credentials|authentication mode/i.test(message)) {
    return 'Shopify rejected the saved credentials.';
  }
  if (/not configured|incomplete/i.test(message)) return 'Shopify credentials are incomplete.';
  return 'Shopify could not be reached.';
}
