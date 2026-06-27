import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleAdsService } from '../../../../services/GoogleAdsService';

function getDateRange() {
  const today = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(today.getDate() - 7);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { start: fmt(sevenDaysAgo), end: fmt(today) };
}

/**
 * GET /api/sync/google-ads?customerId=xxx&refreshToken=xxx
 * Lightweight connection test — credentials come from the business's setup form.
 * App-level OAuth keys are always from ENV; per-business tokens from query params.
 */
export async function GET(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const customerId    = searchParams.get('customerId')    ?? '';
  const refreshToken  = searchParams.get('refreshToken')  ?? '';

  if (!customerId || !refreshToken) {
    return NextResponse.json({ success: false, error: 'customerId and refreshToken are required.' }, { status: 400 });
  }

  try {
    const adsService = new GoogleAdsService(customerId, refreshToken);
    const { start, end } = getDateRange();
    const metrics = await adsService.getLivePerformanceMetrics(start, end);
    return NextResponse.json({ success: true, message: 'Google Ads connection successful.', data: metrics });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: 'Google Ads connection failed.' }, { status: 500 });
  }
}



