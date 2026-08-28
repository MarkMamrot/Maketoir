import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  try {
    const credentials = await getShopifyAdminCredentials(session.businessId);
    if (!credentials) return NextResponse.json({ success: false, error: 'Shopify is not configured.' }, { status: 400 });

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
      authMode: credentials.authMode,
      shopName: payload.data.shop.name ?? credentials.shopName,
      shopDomain: payload.data.shop.myshopifyDomain ?? credentials.shopDomain,
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'shopify',
      operation: 'connection_test',
      title: 'Shopify connection test failed',
      error,
    }).catch(() => undefined);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Shopify connection test failed.' }, { status: 502 });
  }
}