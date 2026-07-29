// src/app/api/sync/analytics/route.ts
import { NextResponse } from 'next/server';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { requireAdminSession } from '@/lib/sessionUtils';
import { GoogleAnalyticsService } from '../../../../services/GoogleAnalyticsService';

/**
 * GET — simple test endpoint, passes propertyId as query param.
 */
export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  try {
    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get('propertyId') || '';
    if (!propertyId) return NextResponse.json({ success: false, error: 'propertyId is required.' }, { status: 400 });
    const connection = await ConnectionsRepository.get(user.businessId);
    const refreshToken = connection?.google_ads_refresh_token ? decrypt(connection.google_ads_refresh_token) : undefined;
    const ga = new GoogleAnalyticsService(propertyId, refreshToken);
    const data = await ga.getRecentPerformance();
    return NextResponse.json({ success: true, message: 'Successfully retrieved Analytics data for the last 7 days', data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}



