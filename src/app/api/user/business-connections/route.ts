import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ConnectionsRepository, CONNECTION_SECRET_FIELDS } from '@/lib/db/ConnectionsRepository';
import { encrypt, decrypt } from '@/lib/encryption';
import { normalizeShopifyShopDomain, type ShopifyAuthMode } from '@/lib/shopifyCredentials';

function requireSession() {
  const session = cookies().get('marketoir_session');
  if (!session) return null;
  try { return JSON.parse(session.value); } catch { return null; }
}

/**
 * GET /api/user/business-connections?databaseId=xxx
 */
export async function GET(req: Request) {
  const user = requireSession();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  if (!databaseId || databaseId !== user.businessId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  try {
    const row = await ConnectionsRepository.get(databaseId);
    const raw = await ConnectionsRepository.getLegacy(databaseId);
    // Decrypt secret fields before returning to frontend
    const data: Record<string, string> = {};
    for (const [key, val] of Object.entries(raw)) {
      data[key] = key === 'MetaAccessToken' || key === 'GoogleAdsRefreshToken' || key === 'ShopifyClientSecret'
        ? ''
        : CONNECTION_SECRET_FIELDS.has(key) ? decrypt(val) : val;
    }
    if (row?.shopify_auth_mode === 'client_credentials') data.ShopifyAccessToken = '';
    data.ShopifyClientSecretConfigured = row?.shopify_client_secret ? 'true' : 'false';
    return NextResponse.json({ success: true, connections: data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/user/business-connections
 * Body: { databaseId: string, connections: { ShopifyShopId, ShopifyAccessToken, ... } }
 */
export async function POST(req: Request) {
  const user = requireSession();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const { databaseId, connections } = await req.json();
  if (!databaseId || databaseId !== user.businessId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  try {
    const requestedShopifyMode = connections?.ShopifyAuthMode as ShopifyAuthMode | undefined;
    if (requestedShopifyMode === 'legacy_token' || requestedShopifyMode === 'client_credentials') {
      const existing = await ConnectionsRepository.get(databaseId);
      const shopDomain = normalizeShopifyShopDomain(String(connections.ShopifyShopId ?? ''));
      if (!shopDomain.endsWith('.myshopify.com')) {
        return NextResponse.json({ success: false, error: 'Enter the permanent Shopify store domain ending in .myshopify.com.' }, { status: 400 });
      }

      if (requestedShopifyMode === 'legacy_token') {
        const submittedToken = String(connections.ShopifyAccessToken ?? '').trim();
        if (!submittedToken && !existing?.shopify_access_token) {
          return NextResponse.json({ success: false, error: 'Enter the legacy Admin API access token.' }, { status: 400 });
        }
        await ConnectionsRepository.upsert(databaseId, {
          shopify_shop_id: shopDomain,
          shopify_auth_mode: 'legacy_token',
          ...(submittedToken ? { shopify_access_token: encrypt(submittedToken) } : {}),
          shopify_client_id: null,
          shopify_client_secret: null,
          shopify_token_expires_at: null,
        });
      } else {
        const clientId = String(connections.ShopifyClientId ?? '').trim();
        const submittedSecret = String(connections.ShopifyClientSecret ?? '').trim();
        const existingSecret = existing?.shopify_auth_mode === 'client_credentials' ? existing.shopify_client_secret : null;
        if (!clientId || (!submittedSecret && !existingSecret)) {
          return NextResponse.json({ success: false, error: 'Enter the Shopify Dev Dashboard client ID and client secret.' }, { status: 400 });
        }
        const credentialsChanged = clientId !== existing?.shopify_client_id || Boolean(submittedSecret);
        await ConnectionsRepository.upsert(databaseId, {
          shopify_shop_id: shopDomain,
          shopify_auth_mode: 'client_credentials',
          shopify_client_id: clientId,
          ...(submittedSecret ? { shopify_client_secret: encrypt(submittedSecret) } : {}),
          ...(credentialsChanged ? { shopify_access_token: null, shopify_token_expires_at: null } : {}),
        });
      }
      return NextResponse.json({ success: true, message: 'Shopify connection settings saved.' });
    }

    // Encrypt secret fields before storing
    const toSave: Record<string, string> = {};
    for (const [key, val] of Object.entries(connections as Record<string, string>)) {
      toSave[key] = CONNECTION_SECRET_FIELDS.has(key) ? encrypt(val ?? '') : (val ?? '');
    }
    await ConnectionsRepository.saveFromLegacy(databaseId, toSave);
    return NextResponse.json({ success: true, message: 'Connection settings saved.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
