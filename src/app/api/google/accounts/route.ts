import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { normalizeGoogleCustomerId, normalizeGooglePropertyId } from '@/lib/googleMarketingOAuth';
import { requireAdminTier } from '@/lib/sessionUtils';
import { listGoogleAdsAccounts, listGoogleAnalyticsProperties, refreshGoogleMarketingAccessToken } from '@/services/GoogleMarketingOAuthService';

function pendingToken(): string {
  const stored = cookies().get('google_marketing_pending')?.value ?? '';
  return stored ? decrypt(stored) : '';
}

async function options(refreshToken: string) {
  const accessToken = await refreshGoogleMarketingAccessToken(refreshToken);
  const [ads, analytics] = await Promise.allSettled([
    listGoogleAdsAccounts(refreshToken),
    listGoogleAnalyticsProperties(accessToken),
  ]);
  return {
    adsAccounts: ads.status === 'fulfilled' ? ads.value : [],
    analyticsProperties: analytics.status === 'fulfilled' ? analytics.value : [],
    warnings: [
      ads.status === 'rejected' ? `Google Ads: ${ads.reason instanceof Error ? ads.reason.message : 'Unable to list accounts.'}` : null,
      analytics.status === 'rejected' ? `Google Analytics: ${analytics.reason instanceof Error ? analytics.reason.message : 'Unable to list properties.'}` : null,
    ].filter(Boolean),
  };
}

export async function GET() {
  const { response } = requireAdminTier();
  if (response) return response;
  const refreshToken = pendingToken();
  if (!refreshToken) return NextResponse.json({ error: 'Google account selection expired. Connect again.' }, { status: 410 });
  try {
    return NextResponse.json({ success: true, ...(await options(refreshToken)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Google accounts.' }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const refreshToken = pendingToken();
  if (!refreshToken) return NextResponse.json({ error: 'Google account selection expired. Connect again.' }, { status: 410 });
  const body = await request.json().catch(() => ({})) as { customerId?: unknown; propertyId?: unknown };
  const customerId = body.customerId == null || body.customerId === '' ? null : normalizeGoogleCustomerId(body.customerId);
  const propertyId = body.propertyId == null || body.propertyId === '' ? null : normalizeGooglePropertyId(body.propertyId);
  if (!customerId && !propertyId) return NextResponse.json({ error: 'Select at least one Google Ads account or Analytics property.' }, { status: 400 });

  const available = await options(refreshToken);
  if (customerId && !available.adsAccounts.some(account => account.customerId === customerId)) {
    return NextResponse.json({ error: 'Select a Google Ads account returned by Google.' }, { status: 400 });
  }
  if (propertyId && !available.analyticsProperties.some(property => property.propertyId === propertyId)) {
    return NextResponse.json({ error: 'Select an Analytics property returned by Google.' }, { status: 400 });
  }
  await ConnectionsRepository.upsert(user.businessId, {
    ...(customerId ? { google_ads_customer_id: customerId } : {}),
    ...(propertyId ? { ga4_property_id: propertyId } : {}),
  });
  const result = NextResponse.json({ success: true, customerId, propertyId });
  result.cookies.delete('google_marketing_pending');
  return result;
}
