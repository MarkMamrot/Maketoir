import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ShopifyService } from '@/services/ShopifyService';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { decrypt } from '@/lib/encryption';

const SHEET_NAME = 'Shopify_Collections';
const LAST_SYNC_CONFIG_KEY = 'WebsiteCollectionsLastSync';

async function readConfig(sheets: GoogleSheetsService, spreadsheetId: string, key: string): Promise<string | null> {
  try {
    const data = await sheets.getData(spreadsheetId, 'Config');
    const row = (data as string[][])?.find(r => r[0] === key);
    return row?.[1] ?? null;
  } catch { return null; }
}

async function writeConfig(sheets: GoogleSheetsService, spreadsheetId: string, key: string, value: string) {
  await sheets.addSheetIfNotExists(spreadsheetId, 'Config', ['Key', 'Value']);
  const data = (await sheets.getData(spreadsheetId, 'Config')) as string[][];
  const rowIndex = data.findIndex(r => r[0] === key);
  if (rowIndex >= 1) {
    await sheets.updateData(spreadsheetId, `Config!A${rowIndex + 1}`, [[key, value]]);
  } else {
    await sheets.appendData(spreadsheetId, 'Config', [[key, value]]);
  }
}

async function getOrCreateWebsiteSheet(sheets: GoogleSheetsService, databaseId: string): Promise<string> {
  const existing = await readConfig(sheets, databaseId, 'WebsiteSheetId');
  if (existing) return existing;
  const folderId = (await readConfig(sheets, databaseId, 'FolderID')) ?? process.env.GOOGLE_USER_DB_FOLDER_ID ?? undefined;
  const newId = await sheets.createBlankSpreadsheet('Business_Website', folderId);
  await writeConfig(sheets, databaseId, 'WebsiteSheetId', newId);
  return newId;
}

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { databaseId } = await req.json();
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });

  try {
    const sheets = new GoogleSheetsService();

    const connRows = await sheets.getData(databaseId, 'Connections');
    if (!connRows || connRows.length < 2) {
      return NextResponse.json({ success: false, error: 'Shopify credentials not configured.' }, { status: 400 });
    }

    const [hdrs, vals] = connRows as string[][];
    const get = (k: string) => vals[hdrs.indexOf(k)] ?? '';

    const rawShopId = get('ShopifyShopId');
    const encryptedToken = get('ShopifyAccessToken');

    if (!rawShopId || !encryptedToken) {
      return NextResponse.json({ success: false, error: 'Shopify credentials not configured.' }, { status: 400 });
    }

    const shopName = rawShopId.replace(/\.myshopify\.com$/, '');
    if (!/^[a-zA-Z0-9-]+$/.test(shopName)) {
      return NextResponse.json({ success: false, error: 'Invalid Shopify shop name.' }, { status: 400 });
    }

    const accessToken = decrypt(encryptedToken);
    const shopDomain = `${shopName}.myshopify.com`;

    const shopify = new ShopifyService(shopName, accessToken);
    const collections = await shopify.getAllCollections(shopDomain);

    const websiteSheetId = await getOrCreateWebsiteSheet(sheets, databaseId);
    await sheets.addSheetIfNotExists(websiteSheetId, SHEET_NAME, ShopifyService.COLLECTION_HEADERS);
    await sheets.resetSheet(websiteSheetId, SHEET_NAME);

    const rows: string[][] = [
      ShopifyService.COLLECTION_HEADERS,
      ...collections.map(c => shopify.toCollectionRow(c)),
    ];
    await sheets.updateData(websiteSheetId, `${SHEET_NAME}!A1`, rows);

    const now = new Date().toLocaleString();
    await writeConfig(sheets, websiteSheetId, LAST_SYNC_CONFIG_KEY, now);

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${websiteSheetId}`;

    return NextResponse.json({ success: true, count: collections.length, lastSync: now, spreadsheetUrl, collections });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });

  try {
    const sheets = new GoogleSheetsService();
    const websiteSheetId = await readConfig(sheets, databaseId, 'WebsiteSheetId');

    if (!websiteSheetId) {
      return NextResponse.json({ success: true, hasData: false, count: 0, lastSync: null, spreadsheetUrl: null });
    }

    const rows = await sheets.getData(websiteSheetId, SHEET_NAME).catch(() => null) as string[][] | null;
    const count = rows && rows.length > 1 ? rows.length - 1 : 0;
    const lastSync = await readConfig(sheets, websiteSheetId, LAST_SYNC_CONFIG_KEY);

    return NextResponse.json({
      success: true,
      hasData: count > 0,
      count,
      lastSync: lastSync ?? null,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${websiteSheetId}`,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
