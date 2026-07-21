import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { decrypt } from '@/lib/encryption';
import { getGlobalSpecsSheetId } from '@/lib/globalApiSpecs';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';

const API_LABELS: Record<string, string> = {
  shopify:      'Shopify Admin REST API',
  ga4:          'Google Analytics 4 Data API',
  'google-ads': 'Google Ads API',
  meta:         'Meta Marketing API',
};

const SCHEMA_HEADERS = ['Field', 'Type', 'Category', 'Description'];

const SCHEMA_PROMPT = (apiLabel: string, summary: string, realData: string) => `
You are an API schema specialist. Based on the documentation below, generate a comprehensive JSON array of ALL available fields, parameters, and operations for the ${apiLabel}.

${realData ? `Live API data sample (these are REAL fields from the API):\n${realData}\n` : ''}

Generate a JSON array where each item has exactly these keys:
- "field": the exact field/parameter name as used in API calls
- "type": one of: string, integer, float, boolean, array, object, enum, datetime, date, currency
- "category": logical grouping (e.g. "Product", "Order", "Customer", "Metric", "Dimension", "Filter", "Endpoint", "Webhook")
- "description": clear, practical description of what this field contains or does

Aim for 80-150+ items covering all major fields, endpoints, filters, and operations.
Return ONLY a valid JSON array. No markdown code fences, no explanation.

Documentation:
${summary}
`.trim();

async function getGeminiModel(databaseId: string): Promise<string> {
  try {
    const conn = await ConnectionsRepository.get(databaseId);
    if (conn?.gemini_model) return conn.gemini_model;
  } catch { /* use default */ }
  return 'gemini-2.5-pro-preview';
}

async function getStoredSummary(sheets: GoogleSheetsService, inventorySystemId: string, api: string): Promise<string> {
  try {
    const rows = await sheets.getData(inventorySystemId, 'APIInstructions!A:C');
    if (rows && rows.length >= 2) {
      const match = rows.slice(1).find((r: any[]) => r[0] === api);
      if (match) return match[1] || '';
    }
  } catch { /* no summary yet */ }
  return '';
}

async function getCredentials(databaseId: string): Promise<Record<string, string>> {
  try {
    const conn = await ConnectionsRepository.get(databaseId);
    if (!conn) return {};
    const data: Record<string, string> = {
      ShopifyShopId:         conn.shopify_shop_id           ?? '',
      ShopifyAccessToken:    conn.shopify_access_token      ? decrypt(conn.shopify_access_token) : '',
      MetaAdAccountId:       conn.meta_ad_account_id        ?? '',
      MetaAccessToken:       conn.meta_access_token         ? decrypt(conn.meta_access_token) : '',
      GA4PropertyId:         conn.ga4_property_id           ?? '',
      GoogleAdsCustomerId:   conn.google_ads_customer_id    ?? '',
      GoogleAdsRefreshToken: conn.google_ads_refresh_token  ? decrypt(conn.google_ads_refresh_token) : '',
    };
    return data;
  } catch { /* no creds */ }
  return {};
}

// ── Endpoint definition extracted by build-api-instructions ──────────────────
interface EndpointDef {
  path: string;
  paginationParam: string;
  responseKey: string | null;
}

async function getStoredEndpoints(
  sheets: GoogleSheetsService,
  inventorySystemId: string,
  api: string,
): Promise<EndpointDef[]> {
  try {
    const rows = await sheets.getData(inventorySystemId, 'APIInstructions!A:D');
    if (rows && rows.length >= 2) {
      const match = rows.slice(1).find((r: any[]) => r[0] === api);
      if (match && match[3]) {
        const parsed = JSON.parse(match[3] as string);
        return Array.isArray(parsed) ? parsed : [];
      }
    }
  } catch { /* no endpoints stored yet */ }
  return [];
}

// ── Per-API fetch configuration ───────────────────────────────────────────────
interface ApiFetchConfig {
  buildUrl: (path: string, paginationParam: string, creds: Record<string, string>) => string;
  buildHeaders: (creds: Record<string, string>) => Record<string, string>;
  canFetch: (creds: Record<string, string>) => boolean;
}

const API_FETCH_CONFIGS: Record<string, ApiFetchConfig> = {
  shopify: {
    buildUrl: (path, paginationParam, creds) => {
      const url = new URL(`https://${creds.ShopifyShopId}${path}`);
      url.searchParams.set(paginationParam || 'limit', '1');
      return url.toString();
    },
    buildHeaders: (creds) => ({ 'X-Shopify-Access-Token': creds.ShopifyAccessToken }),
    canFetch: (creds) => !!(creds.ShopifyShopId && creds.ShopifyAccessToken),
  },
  meta: {
    buildUrl: (path, paginationParam, creds) => {
      const actId = creds.MetaAdAccountId?.startsWith('act_')
        ? creds.MetaAdAccountId
        : `act_${creds.MetaAdAccountId}`;
      const resolved = path
        .replace(/\{act_id\}/gi, actId)
        .replace(/\{ad_account_id\}/gi, actId)
        .replace(/\{adAccountId\}/gi, actId);
      const url = new URL(`https://graph.facebook.com/v19.0${resolved}`);
      url.searchParams.set(paginationParam || 'limit', '1');
      url.searchParams.set('access_token', creds.MetaAccessToken);
      return url.toString();
    },
    buildHeaders: () => ({}),
    canFetch: (creds) => !!(creds.MetaAdAccountId && creds.MetaAccessToken),
  },
  'google-ads': {
    buildUrl: () => '',
    buildHeaders: () => ({}),
    canFetch: () => false, // Gemini knowledge only — no REST list endpoints
  },
};

// ── GA4: use property metadata directly (no Gemini needed) ───────────────────
async function fetchGA4Metadata(creds: Record<string, string>): Promise<any[]> {
  const propertyId = creds.GA4PropertyId;
  if (!propertyId) return [];
  try {
    const { BetaAnalyticsDataClient } = await import('@google-analytics/data');
    const client = new BetaAnalyticsDataClient();
    const [metadata] = await client.getMetadata({ name: `properties/${propertyId}/metadata` });
    const dims = (metadata.dimensions || []).map((d: any) => ({
      field: d.apiName, type: 'string', category: 'Dimension', description: d.description || d.uiName || '',
    }));
    const mets = (metadata.metrics || []).map((m: any) => ({
      field: m.apiName, type: 'float', category: 'Metric', description: m.description || m.uiName || '',
    }));
    return [...dims, ...mets];
  } catch { return []; }
}

// ── Dynamically call every stored endpoint and harvest real field samples ─────
async function fetchFromAllEndpoints(
  api: string,
  endpoints: EndpointDef[],
  creds: Record<string, string>,
): Promise<string> {
  const config = API_FETCH_CONFIGS[api];
  if (!config || !config.canFetch(creds) || !endpoints.length) return '';

  const sections: string[] = [];

  for (const ep of endpoints) {
    try {
      const url = config.buildUrl(ep.path, ep.paginationParam, creds);
      if (!url) continue;
      const headers = config.buildHeaders(creds);
      const res = await fetch(url, { headers });
      if (!res.ok) {
        sections.push(`${ep.path}: HTTP ${res.status} ${res.statusText}`);
        continue;
      }
      const data = await res.json();

      let records: any[] = [];
      if (ep.responseKey && data[ep.responseKey]) {
        const val = data[ep.responseKey];
        records = Array.isArray(val) ? val : [val];
      } else if (Array.isArray(data)) {
        records = data;
      } else if (data?.data && Array.isArray(data.data)) {
        records = data.data;
      } else {
        records = [data];
      }

      if (records.length > 0) {
        const first = records[0];
        const keys = Object.keys(first);
        sections.push(
          `${ep.path} — fields (${keys.length}): ${keys.join(', ')}\n` +
          `Sample: ${JSON.stringify(first, null, 2).slice(0, 1500)}`
        );
      }
    } catch (e: any) {
      console.warn(`fetchFromAllEndpoints(${ep.path}):`, e.message);
      sections.push(`${ep.path}: error — ${e.message}`);
    }
  }

  return sections.join('\n\n---\n\n');
}

// ── OpenAPI spec helpers (Cin7) ─────────────────────────────────────────────

function extractFieldsFromSpec(spec: any): string[][] {
  const rows: string[][] = [];

  // Endpoints from paths
  if (spec.paths) {
    for (const [path, pathItem] of Object.entries<any>(spec.paths)) {
      for (const [method, op] of Object.entries<any>(pathItem as Record<string, any>)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        const tag = (Array.isArray(op.tags) ? op.tags[0] : null)
          ?? path.split('/').filter(Boolean).slice(-1)[0]
          ?? 'API';
        rows.push([
          `${method.toUpperCase()} ${path}`,
          'endpoint',
          `Endpoint-${tag}`,
          String(op.summary ?? op.description ?? ''),
        ]);
      }
    }
  }

  // Fields from definitions (OpenAPI 2.0) or components.schemas (OpenAPI 3.0)
  const schemas: Record<string, any> = spec.definitions ?? spec.components?.schemas ?? {};
  for (const [modelName, schema] of Object.entries<any>(schemas)) {
    const props: Record<string, any> = schema?.properties ?? {};
    const category = modelName.replace(/([A-Z])/g, ' $1').trim().split(' ')[0] ?? modelName;
    for (const [propName, propDef] of Object.entries<any>(props)) {
      const rawType: string = propDef?.type ?? (propDef?.$ref ? 'object' : 'string');
      const mappedType =
        rawType === 'integer' || rawType === 'int32' || rawType === 'int64' ? 'integer'
        : rawType === 'number' || rawType === 'float' || rawType === 'double' ? 'float'
        : rawType === 'boolean' ? 'boolean'
        : rawType === 'array'   ? 'array'
        : rawType === 'object'  ? 'object'
        : 'string';
      rows.push([
        `${modelName}.${propName}`,
        mappedType,
        category,
        String(propDef?.description ?? ''),
      ]);
    }
  }

  return rows;
}

// ── Live field fetchers (Google Ads + Meta) ─────────────────────────────────

async function fetchGoogleAdsFieldSchema(customerId: string, refreshToken: string): Promise<string[][]> {
  const cleanId = customerId.replace(/-/g, '');
  if (!cleanId || !refreshToken) return [];
  try {
    const { GoogleAdsApi } = await import('google-ads-api');
    const client = new GoogleAdsApi({
      client_id:       process.env.GOOGLE_ADS_CLIENT_ID       || '',
      client_secret:   process.env.GOOGLE_ADS_CLIENT_SECRET   || '',
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    });
    const customer = client.Customer({ customer_id: cleanId, refresh_token: refreshToken });
    const results = await customer.query(
      `SELECT name, data_type, category, selectable, filterable, sortable
       FROM google_ads_field
       WHERE category IN ('ATTRIBUTE', 'METRIC', 'SEGMENT', 'RESOURCE')`
    ) as any[];
    const typeMap: Record<string, string> = {
      INT32: 'integer', INT64: 'integer', UINT64: 'integer',
      FLOAT: 'float', DOUBLE: 'float',
      BOOLEAN: 'boolean', DATE: 'date', DATETIME: 'datetime',
      STRING: 'string', ENUM: 'enum', MESSAGE: 'object',
      RESOURCE_NAME: 'string', BYTES: 'string',
    };
    return results.map(r => {
      const f = r.google_ads_field;
      const name: string     = String(f?.name ?? '');
      const rawType: string  = String(f?.data_type ?? '').toUpperCase().replace(/^.*_DATA_TYPE_/, '');
      const category: string = String(f?.category ?? '').toUpperCase().replace(/^.*_CATEGORY_/, '');
      const flags = `selectable:${f?.selectable} filterable:${f?.filterable} sortable:${f?.sortable}`;
      return [name, typeMap[rawType] ?? 'string', category, flags];
    });
  } catch (e: any) {
    console.warn('[build-api-schema] fetchGoogleAdsFieldSchema failed:', e.message);
    return [];
  }
}

async function fetchMetaAdFieldSchema(creds: Record<string, string>): Promise<string[][]> {
  const token = creds.MetaAccessToken;
  if (!token || !creds.MetaAdAccountId) return [];
  const actId = creds.MetaAdAccountId.startsWith('act_')
    ? creds.MetaAdAccountId
    : `act_${creds.MetaAdAccountId}`;
  const rows: string[][] = [];
  const objects = [
    { name: 'AdAccount', url: `https://graph.facebook.com/v19.0/${actId}?metadata=1&access_token=${token}` },
    { name: 'Campaign',  url: `https://graph.facebook.com/v19.0/${actId}/campaigns?limit=1&metadata=1&access_token=${token}` },
    { name: 'AdSet',     url: `https://graph.facebook.com/v19.0/${actId}/adsets?limit=1&metadata=1&access_token=${token}` },
    { name: 'Ad',        url: `https://graph.facebook.com/v19.0/${actId}/ads?limit=1&metadata=1&access_token=${token}` },
    { name: 'Insights',  url: `https://graph.facebook.com/v19.0/${actId}/insights?limit=1&metadata=1&access_token=${token}` },
  ];
  for (const obj of objects) {
    try {
      const res = await fetch(obj.url);
      const data = await res.json();
      // Edge list endpoints wrap metadata under data[0].metadata or root metadata
      const fields: any[] = data.metadata?.fields ?? data.data?.[0]?.metadata?.fields ?? [];
      for (const f of fields) {
        rows.push([
          `${obj.name}.${f.name}`,
          String(f.type ?? 'string').toLowerCase(),
          obj.name,
          String(f.description ?? ''),
        ]);
      }
    } catch { /* skip this object */ }
  }
  return rows;
}

// ── Generic spec persistence (APIInstructions col E) ─────────────────────────

async function persistApiSpec(
  sheets: GoogleSheetsService,
  inventorySystemId: string,
  api: string,
  specJson: string,
): Promise<void> {
  try {
    const rows = await sheets.getData(inventorySystemId, 'APIInstructions!A:E') as string[][];
    const rowIdx = rows?.slice(1).findIndex(r => r[0] === api) ?? -1;
    if (rowIdx >= 0) {
      const sheetRow = rowIdx + 2; // 1-based + header offset
      await sheets.updateData(inventorySystemId, `APIInstructions!E${sheetRow}`, [[specJson]]);
    } else {
      // No existing row — append a minimal stub so the spec is queryable
      const now = new Date().toISOString().split('T')[0];
      await sheets.appendData(inventorySystemId, 'APIInstructions', [[api, '', now, '[]', specJson]]);
    }
  } catch (e) {
    console.warn(`[build-api-schema] persistApiSpec(${api}) failed:`, e);
  }
}

export async function POST(req: Request) {
  const { user, response: authResponse } = requireAdminSession();
  if (authResponse) return authResponse;

  const { api, databaseId } = await req.json();
  if (!api || !databaseId) return NextResponse.json({ error: 'Missing api or databaseId.' }, { status: 400 });
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  const apiLabel = API_LABELS[api];
  if (!apiLabel) return NextResponse.json({ error: `Unknown API: ${api}` }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });

  const sheets = new GoogleSheetsService();

  // Resolve inventorySystemId (for credentials only) and the global specs sheet
  const [creds, inventorySystemId] = await Promise.all([
    getCredentials(databaseId),
    resolveInventorySystemId(databaseId).catch(() => databaseId),
  ]);

  // Global specs sheet — shared across all businesses
  const globalSpecsId = await getGlobalSpecsSheetId(sheets);

  const [modelId, summary, storedEndpoints] = await Promise.all([
    getGeminiModel(databaseId),
    getStoredSummary(sheets, globalSpecsId, api),
    getStoredEndpoints(sheets, globalSpecsId, api),
  ]);

  const sheetName = `Schema_${api.replace(/-/g, '_')}`;
  await sheets.addSheetIfNotExists(globalSpecsId, sheetName, SCHEMA_HEADERS);

  let schemaRows: string[][] | null = null;

  // google-ads: query live google_ads_field service for authoritative field list
  if (api === 'google-ads') {
    const liveRows = await fetchGoogleAdsFieldSchema(
      creds.GoogleAdsCustomerId ?? '',
      creds.GoogleAdsRefreshToken ?? '',
    );
    if (liveRows.length >= 5) {
      schemaRows = liveRows;
      await persistApiSpec(
        sheets, globalSpecsId, 'google-ads',
        JSON.stringify(liveRows.map(r => ({ name: r[0], type: r[1], category: r[2], description: r[3] }))),
      );
    }

  // meta: introspect Marketing API objects via ?metadata=1
  } else if (api === 'meta') {
    const liveRows = await fetchMetaAdFieldSchema(creds);
    if (liveRows.length >= 5) {
      schemaRows = liveRows;
      await persistApiSpec(
        sheets, globalSpecsId, 'meta',
        JSON.stringify(liveRows.map(r => ({ name: r[0], type: r[1], category: r[2], description: r[3] }))),
      );
    }
  }

  if (schemaRows === null) {

  // cin7: fetch the official OpenAPI spec directly — ground truth, no AI guessing needed
  if (api === 'cin7') {
    let spec: any;
    try {
      const specRes = await fetch('https://api.cin7.com/api/OpenApi/GetSpec');
      if (!specRes.ok) {
        return NextResponse.json(
          { error: `Cin7 OpenAPI spec fetch failed: ${specRes.status} ${specRes.statusText}` },
          { status: 502 },
        );
      }
      spec = await specRes.json();
    } catch (e: any) {
      return NextResponse.json({ error: `Could not fetch Cin7 OpenAPI spec: ${e.message}` }, { status: 502 });
    }
    schemaRows = extractFieldsFromSpec(spec);
    // Persist raw spec JSON to APIInstructions col E so the AI Helper can attach it
    await persistApiSpec(sheets, globalSpecsId, 'cin7', JSON.stringify(spec));

  // GA4: use real property metadata directly — perfect accuracy, no Gemini needed
  } else if (api === 'ga4') {
    const ga4Fields = await fetchGA4Metadata(creds);
    if (!ga4Fields.length) {
      return NextResponse.json({ error: 'Could not fetch GA4 metadata. Check GA4 Property ID.' }, { status: 400 });
    }
    schemaRows = ga4Fields.map((f: any) => [f.field, f.type, f.category, f.description || '']);
  } else { // all other APIs (+ google-ads/meta fallback): AI-generated from stored instructions + live endpoint samples
    if (!summary) {
      return NextResponse.json({
        error: 'No API instructions found. Run "Build API Instructions" first.',
      }, { status: 400 });
    }

    // Dynamically call all stored endpoints to gather real field samples
    const realData = await fetchFromAllEndpoints(api, storedEndpoints, creds);

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: modelId,
      contents: SCHEMA_PROMPT(apiLabel, summary, realData),
    });
    const text = response.text?.trim() ?? '';
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let parsed: any[];
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('Schema JSON parse failed:', text.slice(0, 500));
      return NextResponse.json({ error: 'AI returned invalid JSON. Please try again.' }, { status: 500 });
    }

    schemaRows = parsed.map((f: any) => [
      f.field ?? '',
      f.type ?? '',
      f.category ?? '',
      f.description ?? '',
    ]);
  }

  } // end: if (schemaRows === null)

  // Clear old schema and write fresh to global specs sheet
  await sheets.clearSheetContent(globalSpecsId, sheetName);
  await sheets.updateData(globalSpecsId, `${sheetName}!A1`, [SCHEMA_HEADERS, ...schemaRows!]);

  return NextResponse.json({ success: true, api, fieldCount: schemaRows!.length, sheet: sheetName });
}
