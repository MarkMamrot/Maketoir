import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleGenAI } from '@google/genai';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { getGlobalSpecsSheetId } from '@/lib/globalApiSpecs';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';

const SHEET = 'APIInstructions';
const HEADERS = ['API', 'Summary', 'LastUpdated', 'Endpoints'];

const API_LABELS: Record<string, string> = {
  shopify:     'Shopify Admin REST API (v2024-01)',
  ga4:         'Google Analytics 4 Data API (GA4)',
  'google-ads': 'Google Ads API (v16)',
  meta:        'Meta (Facebook) Marketing API (Graph API v19)',
  cin7:        'Cin7 Omni REST API (api.cin7.com/api/v1)',
};

const API_RESOURCE_HINTS: Record<string, string> = {
  'shopify':      'Ensure coverage of: Products, Variants, Collections, Orders, Refunds, Customers, Metafields, Inventory, Locations, Fulfillments, Webhooks, Shop, ScriptTags, Discounts, PriceRules, DraftOrders, CustomCollections, SmartCollections, Blogs, Pages, Themes, Assets, Events, Redirects, Checkouts, Payouts, Transactions, Gift Cards.',
  'ga4':          'Ensure coverage of: runReport, batchRunReports, runPivotReport, runRealtimeReport, getMetadata, checkCompatibility, audienceExports, property metadata dimensions and metrics.',
  'google-ads':   'Ensure coverage of: Campaigns, AdGroups, Ads, Keywords, BiddingStrategies, ConversionActions, Audiences, Feeds, Labels, Budgets, Recommendations, ChangeHistory, CustomerClients, AccountHierarchy, Reports (via GAQL), Assets, Extensions.',
  'meta':         'Ensure coverage of: AdAccounts, Campaigns, AdSets, Ads, AdCreatives, AdImages, AdVideos, CustomAudiences, LeadAds, Insights (breakdowns, action types), Pixels, OfflineConversions, Catalogs, ProductFeeds, ProductSets, BusinessAssets, Pages, InstagramAccounts, Webhooks.',
  'cin7':         'This is Cin7 Omni (NOT Cin7 Core / DEAR Systems). Base URL: https://api.cin7.com/api/v1. Auth: Basic auth with Account ID and API Key. Pagination uses "rows" (page size) and "page" (page number) query parameters. Ensure coverage of ALL these resource groups and their GET/POST/PUT/DELETE methods: Products (/Products, /ProductsList — note pagination via rows/page, filtering via ModifiedDate/Active), Contacts (/Contacts — covers both customers and suppliers), Sale Orders (/SaleOrders, /SaleOrderLines), Invoices (/SaleInvoices), Purchase Orders (/PurchaseOrders, /PurchaseOrderLines), Inventory (/ProductAvailability, /StockAdjustments), Branches/Locations (/Branches), Job Costing (/Jobs), Webhooks (/Webhooks), and any other available endpoints. Document rate limits, error codes, and best practices for incremental sync using ModifiedDate.',

};

const PROMPT = (apiLabel: string, apiKey: string) => `
You are a technical API documentation specialist. Search the web RIGHT NOW for the latest official documentation for the ${apiLabel}. Do not rely on training data alone — look up the current live docs, changelog, and developer reference pages.

IMPORTANT COVERAGE REQUIREMENT: ${API_RESOURCE_HINTS[apiKey] ?? 'Cover all available resources and operations thoroughly.'}

Generate a comprehensive reference guide covering ALL of the following in structured sections:
1. API Overview — what it is, current version, base URL(s)
2. Authentication — method, required credentials, token scopes
3. Rate Limits & Quotas — request limits, retry behaviour
4. Pagination — approach, parameters, cursor vs page-based
5. Complete Endpoint Reference — list EVERY endpoint for EVERY resource group and EVERY HTTP method (GET, POST, PUT, PATCH, DELETE). For each endpoint include:
   - HTTP method
   - Full path
   - Purpose/description
   - Key request body fields (for POST/PUT/PATCH)
   - Key query parameters (for GET)
   Do NOT skip any resource group listed in the coverage requirement above. Do NOT omit write operations.
6. Key Request Parameters & Filters — commonly used query params, filters, date ranges
7. Request & Response Structure — top-level fields in responses, envelope format, error format, example request bodies for POST endpoints
8. Most Important Fields — the 40+ most valuable fields for ecommerce analytics with their types and descriptions (cover ALL major resources)
9. Webhook Events — available event types, payload structure (if applicable)
10. Error Codes — common error codes and their meanings
11. Best Practices — for pulling analytics data efficiently AND for writing data back
12. Recent Changes — any deprecations or important version notes from the last 12 months

Be exhaustive. Cover every resource group. This summary will be used by an AI to autonomously interact with this API.
`.trim();

// Second pass: extract a structured list of callable list endpoints from the summary
const ENDPOINTS_PROMPT = (apiLabel: string, summary: string) => `
From the API documentation below for the ${apiLabel}, extract ALL GET list endpoints that:
1. Return an array/list of records (not a single item requiring a prior ID lookup)
2. Can be paginated with a single query parameter (e.g. rows=1, limit=1, pageSize=1)

For Meta/Facebook API paths, use {act_id} as a placeholder for the ad account ID.

Return a JSON array. Each object must have exactly these keys:
- "path": relative path (e.g. "/api/v1/saleList", "/admin/api/2024-01/orders.json", "/{act_id}/campaigns")
- "paginationParam": query parameter name to limit results (e.g. "rows", "limit")
- "responseKey": the key in the JSON response body that contains the records array, or null if the root response is itself an array

Return ONLY a valid JSON array. No markdown, no explanation.

Documentation:
${summary}
`.trim();

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const { api, databaseId } = await req.json();
  if (!api || !databaseId) return NextResponse.json({ error: 'Missing api or databaseId.' }, { status: 400 });

  const apiLabel = API_LABELS[api];
  if (!apiLabel) return NextResponse.json({ error: `Unknown API: ${api}` }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });

  const sheets = new GoogleSheetsService();

  // Look up the configured Gemini model + inventory system ID from MySQL
  let modelId = 'gemini-2.5-pro-preview';
  let inventorySystemId = databaseId;
  try {
    const conn = await ConnectionsRepository.get(databaseId).catch(() => null);
    if (conn?.gemini_model) modelId = conn.gemini_model;
    inventorySystemId = await resolveInventorySystemId(databaseId).catch(() => databaseId);
  } catch { /* use defaults */ }

  // Global specs sheet is shared across all businesses
  const globalSpecsId = await getGlobalSpecsSheetId(sheets);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: modelId,
      contents: PROMPT(apiLabel, api),
      tools: [{ googleSearch: {} }],
    } as any);
    const summary = response.text?.trim() ?? '';

    // Second pass: extract structured endpoint list from the summary
    let endpointsJson = '[]';
    try {
      const epResponse = await ai.models.generateContent({
        model: modelId,
        contents: ENDPOINTS_PROMPT(apiLabel, summary),
      });
      const epText = epResponse.text?.trim() ?? '';
      const epCleaned = epText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      JSON.parse(epCleaned); // validate
      endpointsJson = epCleaned;
    } catch (e) {
      console.warn('Endpoint extraction failed, storing empty array:', e);
    }

    // Upsert into APIInstructions sheet (global — shared across all businesses)
    await sheets.addSheetIfNotExists(globalSpecsId, SHEET, HEADERS);
    const rows = await sheets.getData(globalSpecsId, `${SHEET}!A:D`);
    const newRow = [api, summary, new Date().toISOString(), endpointsJson];

    if (rows && rows.length >= 2) {
      const existingIdx = rows.slice(1).findIndex((r: any[]) => r[0] === api);
      if (existingIdx >= 0) {
        await sheets.updateData(globalSpecsId, `${SHEET}!A${existingIdx + 2}:D${existingIdx + 2}`, [newRow]);
      } else {
        await sheets.appendData(globalSpecsId, SHEET, [newRow]);
      }
    } else {
      await sheets.appendData(globalSpecsId, SHEET, [newRow]);
    }

    const epCount = (() => { try { return JSON.parse(endpointsJson).length; } catch { return 0; } })();
    return NextResponse.json({ success: true, api, chars: summary.length, endpoints: epCount });
  } catch (error: any) {
    console.error('build-api-instructions error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
