// src/app/api/sync/analytics/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleAnalyticsService } from '../../../../services/GoogleAnalyticsService';
import { GoogleSheetsService } from '../../../../services/GoogleSheetsService';

const TAB = 'GA4';
const HEADERS = ['SyncDate', 'Date', 'Sessions', 'Conversions', 'Revenue'];

// ── Config helpers ────────────────────────────────────────────────────────────
async function readConfig(sheets: GoogleSheetsService, spreadsheetId: string, key: string): Promise<string | null> {
  try {
    const data = await sheets.getData(spreadsheetId, 'Config');
    if (!data) return null;
    const row = (data as string[][]).find(r => r[0] === key);
    return row?.[1] ?? null;
  } catch { return null; }
}

async function writeConfig(sheets: GoogleSheetsService, spreadsheetId: string, key: string, value: string): Promise<void> {
  await sheets.addSheetIfNotExists(spreadsheetId, 'Config', ['Key', 'Value']);
  const data = (await sheets.getData(spreadsheetId, 'Config')) as string[][];
  const rowIndex = data.findIndex(r => r[0] === key);
  if (rowIndex >= 1) {
    await sheets.updateData(spreadsheetId, `Config!A${rowIndex + 1}`, [[key, value]]);
  } else {
    await sheets.appendData(spreadsheetId, 'Config', [[key, value]]);
  }
}

async function getOrCreateMarketingSheet(sheets: GoogleSheetsService, databaseId: string): Promise<string> {
  const existing = await readConfig(sheets, databaseId, 'MarketingDataSheetId');
  if (existing) return existing;
  const folderId = (await readConfig(sheets, databaseId, 'FolderID')) ?? process.env.GOOGLE_USER_DB_FOLDER_ID ?? undefined;
  const newId = await sheets.createBlankSpreadsheet('Marketing Data', folderId);
  await writeConfig(sheets, databaseId, 'MarketingDataSheetId', newId);
  return newId;
}

async function getConnField(sheets: GoogleSheetsService, databaseId: string, field: string): Promise<string> {
  try {
    const rows = await sheets.getData(databaseId, 'Connections');
    if (!rows || rows.length < 2) return '';
    const idx = (rows[0] as string[]).indexOf(field);
    return idx >= 0 ? ((rows[1] as string[])[idx] ?? '') : '';
  } catch { return ''; }
}

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

  try {
    const conn = await ConnectionsRepository.get(databaseId);
    const propertyId = conn?.ga4_property_id ?? '';
    if (!propertyId) {
      return NextResponse.json({ success: false, error: 'GA4 Property ID not found in Connections tab.' }, { status: 400 });
    }

    const ga = new GoogleAnalyticsService(propertyId);
    const rows = await ga.getRecentPerformance();

    const syncDate = new Date().toISOString();
    const dataRows = rows.map((r: any) => [syncDate, r.date, r.sessions, r.conversions, r.revenue]);

    const marketingSheetId = await ConfigRepository.get(databaseId, 'MarketingDataSheetId');
    if (!marketingSheetId) {
      return NextResponse.json({ success: false, error: 'MarketingDataSheetId not configured.' }, { status: 400 });
    }
    const sheets = new GoogleSheetsService();
    // Reset tab so we don't accumulate duplicate date entries
    await sheets.resetSheet(marketingSheetId, TAB, HEADERS);
    if (dataRows.length > 0) {
      await sheets.appendData(marketingSheetId, `${TAB}!A:E`, dataRows);
    }

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${marketingSheetId}`;
    return NextResponse.json({
      success: true,
      message: `GA4 analytics synced to Marketing Data sheet (last 7 days, ${dataRows.length} rows).`,
      spreadsheetUrl,
    });
  } catch (error: any) {
    console.error('sync/analytics POST error:', error);
    return NextResponse.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}

