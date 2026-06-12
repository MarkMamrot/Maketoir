import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { MetaAdsService } from '../../../../services/MetaAdsService';
import { GoogleSheetsService } from '../../../../services/GoogleSheetsService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ConfigRepository } from '@/lib/db/ConfigRepository';
import { decrypt } from '@/lib/encryption';

const TAB = 'MetaAds';
const HEADERS = ['SyncDate', 'DatePreset', 'Spend', 'Impressions', 'Clicks', 'CPA', 'ROAS'];


/**
 * GET — lightweight ping to verify Meta credentials are valid.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const adAccountId = searchParams.get('adAccountId') || process.env.META_AD_ACCOUNT_ID || '';
  const accessToken = searchParams.get('accessToken') || process.env.META_ACCESS_TOKEN || '';

  if (!adAccountId || !accessToken) {
    return NextResponse.json({ success: false, error: 'Meta credentials not configured.' }, { status: 400 });
  }

  try {
    const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${accountId}?fields=id,name&access_token=${accessToken}`
    );
    const data = await res.json();
    if (data.error) {
      return NextResponse.json({ success: false, error: data.error.message }, { status: 401 });
    }
    return NextResponse.json({ success: true, message: `Connected to Meta ad account: ${data.name ?? accountId}` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST — fetch Meta Ads insights and write to Marketing Data sheet.
 * Body: { databaseId: string, datePreset?: string }
 */
export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { databaseId, datePreset = 'last_7d' } = await req.json();
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });

  try {
    const conn = await ConnectionsRepository.get(databaseId);
    const adAccountId = conn?.meta_ad_account_id ?? '';
    const encToken = conn?.meta_access_token ?? '';
    const accessToken = encToken ? decrypt(encToken) : '';

    if (!adAccountId || !accessToken) {
      return NextResponse.json({ success: false, error: 'Meta credentials not found in Connections tab.' }, { status: 400 });
    }

    const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const metaService = new MetaAdsService(accessToken, accountId);
    const raw = await metaService.getLivePerformanceMetrics(datePreset);
    const rows = Array.isArray(raw) ? raw : [raw];

    const syncDate = new Date().toISOString();
    const dataRows = rows.map((r: any) => [
      syncDate,
      datePreset,
      r?.spend ?? r?._data?.spend ?? '',
      r?.impressions ?? r?._data?.impressions ?? '',
      r?.clicks ?? r?._data?.clicks ?? '',
      r?.cpa ?? r?._data?.cpa ?? '',
      r?.roas ?? r?._data?.roas ?? '',
    ]);

    const marketingSheetId = await ConfigRepository.get(databaseId, 'MarketingDataSheetId');
    if (!marketingSheetId) {
      return NextResponse.json({ success: false, error: 'MarketingDataSheetId not configured.' }, { status: 400 });
    }
    const sheets = new GoogleSheetsService();
    await sheets.addSheetIfNotExists(marketingSheetId, TAB, HEADERS);
    await sheets.appendData(marketingSheetId, `${TAB}!A:G`, dataRows);

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${marketingSheetId}`;
    return NextResponse.json({
      success: true,
      message: `Meta Ads data synced to Marketing Data sheet (${datePreset}).`,
      spreadsheetUrl,
    });
  } catch (error: any) {
    console.error('sync/meta-ads POST error:', error);
    return NextResponse.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}

