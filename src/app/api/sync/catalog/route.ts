// src/app/api/sync/catalog/route.ts
import { NextResponse } from 'next/server';
import { ShopifyService } from '../../../../services/ShopifyService';
import { GoogleSheetsService } from '../../../../services/GoogleSheetsService';

/**
 * GET /api/sync/catalog?shopId=...&accessToken=...
 * Quick connection test — fetches 1 product to verify credentials.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const shopId = searchParams.get('shopId') || '';
    const accessToken = searchParams.get('accessToken') || '';
    if (!shopId || !accessToken) {
      return NextResponse.json({ success: false, error: 'shopId and accessToken are required.' }, { status: 400 });
    }
    const shopify = new ShopifyService(shopId, accessToken);
    const catalog = await shopify.getCatalog();
    return NextResponse.json({ success: true, message: `Connected — ${catalog.length} products found.`, count: catalog.length });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * Phase 1 + 2: "The Brain Sync" (Initial Audit & Margin Mapping)
 * 1. Read catalog from Shopify.
 * 2. Save mapped struct to Google Sheets.
 */
export async function POST(req: Request) {
  try {
    const { shopId, accessToken, spreadsheetId } = await req.json();

    const shopify = new ShopifyService(shopId, accessToken);
    const catalog = await shopify.getCatalog();

    const sheets = new GoogleSheetsService(spreadsheetId);
    await sheets.syncProductCatalog(catalog);

    return NextResponse.json({
      success: true,
      message: `Successfully synchronized ${catalog.length} products to "Brand DNA".`,
      data: catalog,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
