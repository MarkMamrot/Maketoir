import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleAdsService } from '../../../../services/GoogleAdsService';
import { GoogleSheetsService } from '../../../../services/GoogleSheetsService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ConfigRepository } from '@/lib/db/ConfigRepository';

const TAB = 'GoogleAds';
const HEADERS = ['SyncDate', 'DateRangeStart', 'DateRangeEnd', 'Spend', 'Clicks', 'Conversions', 'ConversionValue'];

function getDateRange() {
  const today = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(today.getDate() - 7);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { start: fmt(sevenDaysAgo), end: fmt(today) };
}


export async function GET(req: Request) {
  // Simple connection test (no auth required)
  try {
    const adsService = new GoogleAdsService();
    const { start, end } = getDateRange();
    const metrics = await adsService.getLivePerformanceMetrics(start, end);
    return NextResponse.json({ success: true, message: 'Successfully retrieved Google Ads data for last 7 days', data: metrics });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}

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
    const customerId = conn?.google_ads_customer_id ?? '';
    if (!customerId && !process.env.GOOGLE_ADS_CUSTOMER_ID) {
      return NextResponse.json({ success: false, error: 'Google Ads Customer ID not configured in Connections tab.' }, { status: 400 });
    }

    const sheets = new GoogleSheetsService();
    const { start, end } = getDateRange();
    const adsService = new GoogleAdsService(customerId || undefined);
    const raw = await adsService.getLivePerformanceMetrics(start, end);
    const rows = Array.isArray(raw) ? raw : [raw];

    // Aggregate metrics across all campaign rows
    let totalSpend = 0, totalClicks = 0, totalConversions = 0, totalConversionValue = 0;
    for (const row of rows) {
      totalSpend         += Number(row?.metrics?.cost_micros ?? 0) / 1_000_000;
      totalClicks        += Number(row?.metrics?.clicks ?? 0);
      totalConversions   += Number(row?.metrics?.conversions ?? 0);
      totalConversionValue += Number(row?.metrics?.conversions_value ?? 0);
    }

    const syncDate = new Date().toISOString();
    const dataRow = [
      syncDate, start, end,
      totalSpend.toFixed(2), totalClicks, totalConversions.toFixed(2), totalConversionValue.toFixed(2),
    ];

    // Write to Marketing Data spreadsheet
    const marketingSheetId = await ConfigRepository.get(databaseId, 'MarketingDataSheetId');
    if (!marketingSheetId) {
      return NextResponse.json({ success: false, error: 'MarketingDataSheetId not configured.' }, { status: 400 });
    }
    await sheets.addSheetIfNotExists(marketingSheetId, TAB, HEADERS);
    await sheets.appendData(marketingSheetId, `${TAB}!A:G`, [dataRow]);

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${marketingSheetId}`;
    return NextResponse.json({
      success: true,
      message: `Google Ads data synced to Marketing Data sheet (${start} → ${end}).`,
      spreadsheetUrl,
    });
  } catch (error: any) {
    console.error('sync/google-ads POST error:', error);
    return NextResponse.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}

