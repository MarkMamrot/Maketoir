import type { ConnectionsRow } from '@/lib/db/ConnectionsRepository';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt, encrypt } from '@/lib/encryption';
import { getOnlineChannelCapabilities } from '@/lib/ims/businessOperations';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export type ShopifyAuthMode = 'legacy_token' | 'client_credentials';

export interface ShopifyAdminCredentials {
  authMode: ShopifyAuthMode;
  shopDomain: string;
  shopName: string;
  token: string;
}

type ShopifyCredentialDependencies = {
  fetchImpl: typeof fetch;
  now: () => number;
  encryptToken: typeof encrypt;
  persistToken: (businessId: string, encryptedToken: string, expiresAt: number) => Promise<void>;
};

const TOKEN_RENEWAL_MARGIN_MS = 5 * 60 * 1000;

function decryptStoredValue(value: string | null): string {
  const stored = value ?? '';
  try { return decrypt(stored); } catch { return stored; }
}

const defaultDependencies: ShopifyCredentialDependencies = {
  fetchImpl: fetch,
  now: Date.now,
  encryptToken: value => encrypt(value),
  persistToken: async (businessId, encryptedToken, expiresAt) => {
    await ConnectionsRepository.upsert(businessId, {
      shopify_access_token: encryptedToken,
      shopify_token_expires_at: expiresAt,
    });
  },
};

export function normalizeShopifyShopDomain(value: string): string {
  const normalized = value.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  return /^[a-z0-9][a-z0-9-]*$/.test(normalized) ? `${normalized}.myshopify.com` : normalized;
}

export async function resolveShopifyAdminCredentials(
  businessId: string,
  connection: ConnectionsRow,
  dependencies: ShopifyCredentialDependencies = defaultDependencies,
): Promise<ShopifyAdminCredentials> {
  const shopDomain = normalizeShopifyShopDomain(connection.shopify_shop_id ?? '');
  if (!shopDomain || !shopDomain.endsWith('.myshopify.com')) {
    throw new Error('Enter the permanent Shopify store domain ending in .myshopify.com.');
  }

  const shopName = shopDomain.slice(0, -'.myshopify.com'.length);
  const authMode: ShopifyAuthMode = connection.shopify_auth_mode === 'client_credentials'
    ? 'client_credentials'
    : 'legacy_token';

  if (authMode === 'legacy_token') {
    const token = decryptStoredValue(connection.shopify_access_token).trim();
    if (!token) throw new Error('Shopify Admin API access token is not configured.');
    return { authMode, shopDomain, shopName, token };
  }

  const cachedToken = decryptStoredValue(connection.shopify_access_token).trim();
  const expiresAt = Number(connection.shopify_token_expires_at ?? 0);
  if (cachedToken && Number.isFinite(expiresAt) && expiresAt > dependencies.now() + TOKEN_RENEWAL_MARGIN_MS) {
    return { authMode, shopDomain, shopName, token: cachedToken };
  }

  const clientId = (connection.shopify_client_id ?? '').trim();
  const clientSecret = decryptStoredValue(connection.shopify_client_secret).trim();
  if (!clientId || !clientSecret) throw new Error('Shopify Dev Dashboard client credentials are incomplete.');

  const response = await dependencies.fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Shopify token request failed with HTTP ${response.status}. Confirm the app is installed on this organization-owned store.`);
  }

  const payload = await response.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
  const token = payload?.access_token?.trim() ?? '';
  const expiresIn = Number(payload?.expires_in ?? 0);
  if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Shopify returned an invalid client-credentials token response.');
  }

  const tokenExpiresAt = dependencies.now() + expiresIn * 1000;
  await dependencies.persistToken(businessId, dependencies.encryptToken(token), tokenExpiresAt);
  return { authMode, shopDomain, shopName, token };
}

export async function getShopifyAdminCredentials(businessId: string): Promise<ShopifyAdminCredentials | null> {
  const capabilities = await getOnlineChannelCapabilities(businessId);
  if (!capabilities.shopifyEnabled) return null;
  const connection = await ConnectionsRepository.get(businessId);
  if (!connection?.shopify_shop_id) return null;

  try {
    return await resolveShopifyAdminCredentials(businessId, connection);
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'shopify',
      operation: 'admin_api_authentication',
      title: 'Shopify authentication failed',
      error,
      context: {
        authMode: connection.shopify_auth_mode === 'client_credentials' ? 'client_credentials' : 'legacy_token',
        shopDomain: normalizeShopifyShopDomain(connection.shopify_shop_id),
      },
    }).catch(() => undefined);
    throw error;
  }
}