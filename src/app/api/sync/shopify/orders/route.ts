import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ShopifyService } from '@/services/ShopifyService';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { decrypt } from '@/lib/encryption';

const SHEET_NAME = 'Shopify_Orders';
const LAST_SYNC_CONFIG_KEY = 'WebsiteOrdersLastSync';

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

/**
 * POST /api/sync/shopify/orders
 * Body: { databaseId: string, monthsBack?: number }
 *
 * Fetches all Shopify orders from the last `monthsBack` months (default 24)
 * and writes them to the `Shopify_Orders` tab in the Business_Website spreadsheet.
 * Includes the customer's lifetime order count so new-vs-returning analysis
 * can be done directly in the spreadsheet.
 *
 * Returns: { success, count, lastSync, spreadsheetUrl }
 */
export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { databaseId, monthsBack = 24 } = await req.json();
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });
  const _u = JSON.parse(session.value);
  if (databaseId !== _u.businessId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  try {
    const sheets = new GoogleSheetsService();

    // ── 1. Read Shopify credentials ─────────────────────────────────────────
    const connRows = await sheets.getData(databaseId, 'Connections');
    if (!connRows || connRows.length < 2) {
      return NextResponse.json({ success: false, error: 'Shopify credentials not configured. Go to Setup → Connections.' }, { status: 400 });
    }

    const [hdrs, vals] = connRows as string[][];
    const get = (k: string) => vals[hdrs.indexOf(k)] ?? '';

    const rawShopId = get('ShopifyShopId');
    const encryptedToken = get('ShopifyAccessToken');

    if (!rawShopId || !encryptedToken) {
      return NextResponse.json({ success: false, error: 'Shopify credentials not configured. Go to Setup → Connections.' }, { status: 400 });
    }

    const shopName = rawShopId.replace(/\.myshopify\.com$/, '');
    // Validate shop name to prevent SSRF
    if (!/^[a-zA-Z0-9-]+$/.test(shopName)) {
      return NextResponse.json({ success: false, error: 'Invalid Shopify shop name.' }, { status: 400 });
    }

    const accessToken = decrypt(encryptedToken);

    // ── 2. Fetch orders ─────────────────────────────────────────────────────
    const shopify = new ShopifyService(shopName, accessToken);
    const months = Math.max(1, Math.min(36, Number(monthsBack) || 24)); // clamp 1–36
    const orders = await shopify.getOrdersForSync(months);

    // ── 3. Get / create Business_Website spreadsheet ────────────────────────
    const websiteSheetId = await getOrCreateWebsiteSheet(sheets, databaseId);

    // ── 4. Write Shopify_Orders tab ─────────────────────────────────────────
    await sheets.addSheetIfNotExists(websiteSheetId, SHEET_NAME, ShopifyService.ORDER_HEADERS);
    await sheets.resetSheet(websiteSheetId, SHEET_NAME);

    const rows: string[][] = [
      ShopifyService.ORDER_HEADERS,
      ...orders.map(o => shopify.toOrderRow(o)),
    ];
    await sheets.updateData(websiteSheetId, `${SHEET_NAME}!A1`, rows);

    const now = new Date().toLocaleString();
    await writeConfig(sheets, websiteSheetId, LAST_SYNC_CONFIG_KEY, now);

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${websiteSheetId}`;

    return NextResponse.json({ success: true, count: orders.length, lastSync: now, spreadsheetUrl });
  } catch (err: any) {
    console.error('[shopify-orders-sync] Error:', err);
    const msg: string = err.message ?? String(err);
    // Shopify returns 403 when the access token is missing the read_orders scope
    if (msg.includes('403') || msg.toLowerCase().includes('forbidden') || msg.toLowerCase().includes('access denied')) {
      return NextResponse.json({
        success: false,
        error: 'Shopify returned 403 Forbidden — your access token is missing the "read_orders" scope. In your Shopify admin go to Apps → develop apps → your app → Configuration → Admin API access scopes and enable "read_orders", then regenerate the access token and update it in Setup → Connections.',
      }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
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
