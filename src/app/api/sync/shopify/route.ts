import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ShopifyService } from '@/services/ShopifyService';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { decrypt } from '@/lib/encryption';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';

const SHEET_NAME = 'Shopify_Products';
const LAST_SYNC_CONFIG_KEY = 'WebsiteProductsLastSync';

/**
 * Reads a key from the Config tab of a spreadsheet.
 */
async function readConfig(
  sheets: GoogleSheetsService,
  spreadsheetId: string,
  key: string,
): Promise<string | null> {
  try {
    const data = await sheets.getData(spreadsheetId, 'Config');
    if (!data) return null;
    const row = (data as string[][]).find(r => r[0] === key);
    return row?.[1] ?? null;
  } catch {
    return null;
  }
}

async function writeConfig(
  sheets: GoogleSheetsService,
  spreadsheetId: string,
  key: string,
  value: string,
): Promise<void> {
  await sheets.addSheetIfNotExists(spreadsheetId, 'Config', ['Key', 'Value']);
  const data = (await sheets.getData(spreadsheetId, 'Config')) as string[][];
  const rowIndex = data.findIndex(r => r[0] === key);
  if (rowIndex >= 1) {
    await sheets.updateData(spreadsheetId, `Config!A${rowIndex + 1}`, [[key, value]]);
  } else {
    await sheets.appendData(spreadsheetId, 'Config', [[key, value]]);
  }
}


/**
 * POST /api/sync/shopify
 * Body: { databaseId: string, inStockOnly?: boolean }
 *
 * Fetches all Shopify products (paginated) and writes them to the
 * `Shopify_Products` tab in the business Business_Website spreadsheet.
 * When inStockOnly is true, only products with inventory_qty > 0 are written.
 *
 * Returns: { success, count, totalFetched, spreadsheetUrl, products }
 */
export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const { databaseId, inStockOnly = false } = await req.json();
  if (!databaseId) {
    return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });
  }
  const _u = JSON.parse(session.value);
  if (databaseId !== _u.userSpreadsheetId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  try {
    // ── 1. Read Shopify credentials ─────────────────────────────────────────
    const conn = await ConnectionsRepository.get(databaseId);
    const rawShopId = conn?.shopify_shop_id ?? '';
    const encryptedToken = conn?.shopify_access_token ?? '';

    if (!rawShopId || !encryptedToken) {
      return NextResponse.json(
        { success: false, error: 'Shopify credentials not configured. Go to Setup → Connections.' },
        { status: 400 },
      );
    }

    // Normalise: strip .myshopify.com if the user stored the full domain
    const shopName = rawShopId.replace(/\.myshopify\.com$/, '');
    // Validate shop name (alphanumeric + hyphens only) to prevent SSRF
    if (!/^[a-zA-Z0-9-]+$/.test(shopName)) {
      return NextResponse.json({ success: false, error: 'Invalid Shopify shop name.' }, { status: 400 });
    }

    const accessToken = decrypt(encryptedToken);

    // ── 2. Fetch all products from Shopify ──────────────────────────────────
    const shopify = new ShopifyService(shopName, accessToken);
    console.log('[shopify-sync] Fetching all products…');
    const allProducts = await shopify.getAllProducts();
    console.log(`[shopify-sync] Fetched ${allProducts.length} products.`);

    const products = inStockOnly
      ? allProducts.filter(p => p.inventory_qty > 0)
      : allProducts;

    if (inStockOnly) {
      console.log(`[shopify-sync] Filtered to ${products.length} in-stock products (inStockOnly=true).`);
    }

    // ── 3. Get Business_Website spreadsheet ────────────────────────────────
    const websiteSheetId = conn.website_sheet_id;
    if (!websiteSheetId) {
      return NextResponse.json({ success: false, error: 'Website sheet not configured.' }, { status: 400 });
    }

    // ── 4. Write Shopify_Products tab ───────────────────────────────────────
    const sheets = new GoogleSheetsService();
    await sheets.addSheetIfNotExists(websiteSheetId, SHEET_NAME, ShopifyService.PRODUCT_HEADERS);
    await sheets.resetSheet(websiteSheetId, SHEET_NAME);

    const rows: string[][] = [
      ShopifyService.PRODUCT_HEADERS,
      ...products.map(p => shopify.toSheetRow(p)),
    ];
    await sheets.updateData(websiteSheetId, `${SHEET_NAME}!A1`, rows);

    const now = new Date().toLocaleString();
    await writeConfig(sheets, websiteSheetId, LAST_SYNC_CONFIG_KEY, now);

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${websiteSheetId}`;

    return NextResponse.json({
      success: true,
      count: products.length,
      totalFetched: allProducts.length,
      lastSync: now,
      spreadsheetUrl,
      products,
    });
  } catch (err: any) {
    console.error('[shopify-sync] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  if (!databaseId) {
    return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });
  }

  try {
    const conn = await ConnectionsRepository.get(databaseId);
    const websiteSheetId = conn?.website_sheet_id ?? null;

    if (!websiteSheetId) {
      return NextResponse.json({ success: true, hasData: false, count: 0, lastSync: null, spreadsheetUrl: null });
    }

    const sheets = new GoogleSheetsService();
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
