import { NextResponse } from 'next/server';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { requireAdminSession } from '@/lib/sessionUtils';
import { GoogleAdsService } from '@/services/GoogleAdsService';
import { GoogleAnalyticsService } from '@/services/GoogleAnalyticsService';
import { googleMarketingOAuthConfigurationStatus } from '@/services/GoogleMarketingOAuthService';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const configuration = googleMarketingOAuthConfigurationStatus();
  try {
    const connection = await ConnectionsRepository.get(user.businessId);
    return NextResponse.json({
      ...configuration,
      authorised: Boolean(connection?.google_ads_refresh_token),
      adsConnected: Boolean(connection?.google_ads_refresh_token && connection?.google_ads_customer_id),
      analyticsConnected: Boolean(connection?.google_ads_refresh_token && connection?.ga4_property_id),
      customerId: connection?.google_ads_customer_id ?? null,
      propertyId: connection?.ga4_property_id ?? null,
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error) {
    return NextResponse.json({ ...configuration, authorised: false, adsConnected: false, analyticsConnected: false, customerId: null, propertyId: null, connectionError: error instanceof Error ? error.message : 'Unable to read the saved Google connection.' });
  }
}

export async function POST(request: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const body = await request.json().catch(() => ({})) as { service?: unknown };
  const service = String(body.service ?? '');
  const connection = await ConnectionsRepository.get(user.businessId);
  if (!connection?.google_ads_refresh_token) return NextResponse.json({ success: false, error: 'Google is not connected.' }, { status: 409 });
  const refreshToken = decrypt(connection.google_ads_refresh_token);
  try {
    if (service === 'ads') {
      if (!connection.google_ads_customer_id) throw new Error('No Google Ads account is selected.');
      const end = new Date();
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 7);
      const formatDate = (date: Date) => date.toISOString().slice(0, 10);
      const data = await new GoogleAdsService(connection.google_ads_customer_id, refreshToken).getLivePerformanceMetrics(formatDate(start), formatDate(end));
      return NextResponse.json({ success: true, data });
    }
    if (service === 'analytics') {
      if (!connection.ga4_property_id) throw new Error('No Google Analytics property is selected.');
      const data = await new GoogleAnalyticsService(connection.ga4_property_id, refreshToken).getRecentPerformance();
      return NextResponse.json({ success: true, data });
    }
    return NextResponse.json({ success: false, error: 'service must be ads or analytics.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Google connection test failed.' }, { status: 502 });
  }
}
