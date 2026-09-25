import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { getShopifyOperationContext, ShopifyOperationContextError } from '@/lib/channels/shopifyOperationContext';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  const disabled = await shopifyDisabledResponse(session.businessId);
  if (disabled) return disabled;
  const body = await req.json().catch(() => ({}));
  const channelInstanceId = String(body?.channelInstanceId ?? '').trim();
  if (!channelInstanceId) {
    return NextResponse.json({ success: false, error: 'Select a Shopify storefront.' }, { status: 400 });
  }

  try {
    const { credentials, instance } = await getShopifyOperationContext({
      businessId: session.businessId,
      channelInstanceId,
    });

    const response = await fetch(`https://${credentials.shopDomain}/admin/api/2025-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': credentials.token,
      },
      body: JSON.stringify({ query: 'query SolvantisConnectionTest { shop { name myshopifyDomain } }' }),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null) as {
      data?: { shop?: { name?: string; myshopifyDomain?: string } };
      errors?: Array<{ message?: string }>;
    } | null;
    if (!response.ok || payload?.errors?.length || !payload?.data?.shop) {
      throw new Error(payload?.errors?.[0]?.message || `Shopify connection test failed with HTTP ${response.status}.`);
    }

    return NextResponse.json({
      success: true,
      channelInstanceId,
      displayName: instance.displayName,
      authMode: credentials.authMode,
      shopName: payload.data.shop.name ?? credentials.shopName,
      shopDomain: payload.data.shop.myshopifyDomain ?? credentials.shopDomain,
    });
  } catch (error) {
    if (error instanceof ShopifyOperationContextError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'shopify',
      operation: 'connection_test',
      title: 'Shopify connection test failed',
      error,
      context: { channelInstanceId },
    }).catch(() => undefined);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Shopify connection test failed.' }, { status: 502 });
  }
}