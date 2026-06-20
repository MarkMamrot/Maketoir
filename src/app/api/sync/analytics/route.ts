// src/app/api/sync/analytics/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleAnalyticsService } from '../../../../services/GoogleAnalyticsService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { MarketingDataRepository } from '@/lib/db/MarketingDataRepository';

/**
 * GET — simple test endpoint, passes propertyId as query param.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get('propertyId') || '';
    if (!propertyId) return NextResponse.json({ success: false, error: 'propertyId is required.' }, { status: 400 });
    const ga = new GoogleAnalyticsService(propertyId);
    const data = await ga.getRecentPerformance();
    return NextResponse.json({ success: true, message: 'Successfully retrieved Analytics data for the last 7 days', data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST — fetch GA4 analytics and write to Marketing Data sheet.
 * Body: { databaseId: string }
 */
export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { databaseId } = await req.json();
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });
  const _u = JSON.parse(session.value);
  if (databaseId !== _u.userSpreadsheetId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  try {
    const conn = await ConnectionsRepository.get(databaseId);
    const propertyId = conn?.ga4_property_id ?? '';
    if (!propertyId) {
      return NextResponse.json({ success: false, error: 'GA4 Property ID not found in Connections.' }, { status: 400 });
    }

    const ga = new GoogleAnalyticsService(propertyId);
    const rows = await ga.getRecentPerformance();

    const headers = ['Date', 'Sessions', 'Conversions', 'Revenue'];
    const dataRows: string[][] = rows.map((r: any) => [r.date, String(r.sessions), String(r.conversions), String(r.revenue)]);

    await MarketingDataRepository.replaceTab(databaseId, 'ga4', propertyId, 'GA4', [headers, ...dataRows]);

    return NextResponse.json({
      success: true,
      message: `GA4 analytics synced to database (last 7 days, ${dataRows.length} rows).`,
    });
  } catch (error: any) {
    console.error('sync/analytics POST error:', error);
    return NextResponse.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}

