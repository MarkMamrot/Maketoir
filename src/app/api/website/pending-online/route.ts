import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';

// Products sheet column indices (from sync/products/route.ts HEADERS)
const COL_ID           = 0;
const COL_STYLE_CODE   = 1;
const COL_NAME         = 2;
const COL_BRAND        = 3;
const COL_ONLINE       = 5;
const COL_OPTION_ID    = 7;
const COL_CODE         = 8;  // SKU / variant code
const COL_BARCODE      = 9;  // barcode
const COL_COST         = 10;
const COL_RETAIL_PRICE = 11;
const COL_GLOBAL_SOH   = 15;

// Shopify_Products sheet column indices (from ShopifyService.PRODUCT_HEADERS)
const SHOPIFY_COL_SKU  = 11;

/**
 * GET /api/website/pending-online?databaseId=...&batchSize=50
 *
 * Returns Cin7 products that have online=1 but whose SKU does not yet appear
 * in the Shopify_Products sheet, up to batchSize items.
 */
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

  const batchSize = Math.min(Math.max(parseInt(searchParams.get('batchSize') ?? '50', 10) || 50, 1), 500);

  try {
    const sheets = new GoogleSheetsService();

    // ── 1. Read Config to get inventorySystemId and WebsiteSheetId ───────────
    const configRows = await sheets.getData(databaseId, 'Config!A:B') as string[][] | null;
    if (!configRows) {
      return NextResponse.json({ success: false, error: 'Could not read Config.' }, { status: 500 });
    }

    const getConfig = (key: string) => configRows.find(r => r[0] === key)?.[1] ?? '';

    const inventorySystemId = getConfig('Inventory System') || databaseId;
    const websiteSheetId    = getConfig('WebsiteSheetId');

    // ── 2. Load Products sheet ───────────────────────────────────────────────
    const productRows = await sheets.getData(inventorySystemId, 'Products') as string[][] | null;
    if (!productRows || productRows.length < 2) {
      return NextResponse.json({
        success: true,
        products: [],
        totalOnline: 0,
        totalPending: 0,
        message: 'No products found. Run a Cin7 products sync first.',
      });
    }

    // Skip header row, filter to online=1
    const onlineProducts = productRows.slice(1).filter(r => r[COL_ONLINE] === '1');

    // ── 3. Build set of SKUs already in Shopify ──────────────────────────────
    const shopifySkus = new Set<string>();
    if (websiteSheetId) {
      const shopifyRows = await sheets.getData(websiteSheetId, 'Shopify_Products').catch(() => null) as string[][] | null;
      if (shopifyRows && shopifyRows.length > 1) {
        for (const row of shopifyRows.slice(1)) {
          const sku = row[SHOPIFY_COL_SKU];
          if (sku) shopifySkus.add(sku.trim());
        }
      }
    }

    // ── 4. Filter to products NOT already in Shopify ────────────────────────
    const pending = onlineProducts
      .filter(r => {
        const code = (r[COL_CODE] ?? '').trim();
        if (!code || shopifySkus.has(code)) return false;
        // Exclude products with no stock
        const soh = parseFloat(r[COL_GLOBAL_SOH] ?? '0') || 0;
        if (soh < 1) return false;
        return true;
      })
      .sort((a, b) => {
        const sohA = parseFloat(a[COL_GLOBAL_SOH] ?? '0') || 0;
        const sohB = parseFloat(b[COL_GLOBAL_SOH] ?? '0') || 0;
        return sohB - sohA;
      });

    const batch = pending.slice(0, batchSize).map(r => ({
      id:          r[COL_ID]           ?? '',
      styleCode:   r[COL_STYLE_CODE]   ?? '',
      name:        r[COL_NAME]         ?? '',
      brand:       r[COL_BRAND]        ?? '',
      optionId:    r[COL_OPTION_ID]    ?? '',
      code:        r[COL_CODE]         ?? '',
      cost:        r[COL_COST]         ?? '',
      retailPrice: r[COL_RETAIL_PRICE] ?? '',
      soh:         r[COL_GLOBAL_SOH]   ?? '',
      barcode:     r[COL_BARCODE]       ?? '',
    }));

    return NextResponse.json({
      success: true,
      products: batch,
      totalOnline: onlineProducts.length,
      totalPending: pending.length,
      batchSize,
      hasWebsiteSheet: !!websiteSheetId,
    });
  } catch (err: any) {
    console.error('[pending-online] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
