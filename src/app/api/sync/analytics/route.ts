// src/app/api/sync/analytics/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleAnalyticsService } from '../../../../services/GoogleAnalyticsService';

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



