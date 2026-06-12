import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { GoogleAdsService } from '@/services/GoogleAdsService';
import { MetaAdsService } from '@/services/MetaAdsService';
import { GoogleAnalyticsService } from '@/services/GoogleAnalyticsService';
import { GoogleGenAI } from '@google/genai';
import { decrypt } from '@/lib/encryption';
import { getGlobalSpecsSheetId } from '@/lib/globalApiSpecs';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { BusinessInfoRepository } from '@/lib/db/BusinessInfoRepository';
import { BrandProfileRepository } from '@/lib/db/BrandProfileRepository';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ConfigRepository } from '@/lib/db/ConfigRepository';
import { CalcReportsRepository, YearlyRevenueRepository } from '@/lib/db/CalcReportsRepository';
import { ProductsRepository } from '@/lib/db/ProductsRepository';
import { SalesRepository } from '@/lib/db/SalesRepository';
import { ChatsRepository } from '@/lib/db/ChatsRepository';

// ── System context ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert business consultant, marketing strategist, and data analyst working with a retail/e-commerce business. You have been given access to real data from the business's connected systems — including their product catalogue, sales history, brand profile, advertising performance, and website data. Your role is to help the business owner make informed, data-driven decisions across marketing, inventory management, pricing strategy, customer engagement, and business growth. Be specific and actionable. Cite relevant data when making recommendations. If data for a topic is not available, say so clearly rather than guessing.`;

// ── Data gatherers ─────────────────────────────────────────────────────────────

async function gatherBusinessInfo(_sheets: GoogleSheetsService, databaseId: string): Promise<string> {
  try {
    const info = await BusinessInfoRepository.get(databaseId);
    if (!info) return '=== BUSINESS INFORMATION ===\nNot configured.';
    return [
      '=== BUSINESS INFORMATION ===',
      `Brand Name: ${info.brand_name || 'N/A'}`,
      `Website: ${info.brand_url || 'N/A'}`,
      `Years in Business: ${info.years_in_business || 'N/A'}`,
      `Facebook: ${info.facebook_link || 'N/A'}`,
      `Instagram: ${info.instagram_link || 'N/A'}`,
      `Pinterest: ${info.pinterest_link || 'N/A'}`,
    ].join('\n');
  } catch {
    return '=== BUSINESS INFORMATION ===\nNot available.';
  }
}

async function gatherBrandProfile(_sheets: GoogleSheetsService, databaseId: string): Promise<string> {
  try {
    const bp = await BrandProfileRepository.get(databaseId);
    if (!bp) return '=== BRAND PROFILE ===\nNot configured.';
    const lines: string[] = ['=== BRAND PROFILE ==='];
    const fields: [keyof typeof bp, string][] = [
      ['mission',            'Brand Mission'],
      ['uvp',                'Unique Value Proposition'],
      ['tone',               'Brand Tone & Voice'],
      ['demographics',       'Target Demographics'],
      ['geo',                'Top Geographies'],
      ['hero_products',      'Hero Products'],
      ['price_positioning',  'Price Positioning & AOV'],
      ['praises',            'Core Customer Praises'],
      ['objections',         'Core Objections'],
      ['competitors',        'Primary Competitors'],
      ['market_gap',         'Market Gap'],
      ['logo_url',           'Logo URL'],
      ['brand_colours',      'Brand Colours'],
      ['shipping_policy',    'Shipping Policy'],
      ['connected_software', 'Connected Software'],
      ['operations_summary', 'Business Operations Summary'],
      ['returns_policy',     'Returns Policy'],
      ['brand_history',      'Brand History'],
      ['physical_branches',  'Physical Branches'],
      ['loyalty_program',    'Loyalty Program'],
    ];
    for (const [key, label] of fields) {
      const val = String(bp[key] ?? '').trim();
      if (val) lines.push(`${label}: ${val}`);
    }
    return lines.join('\n');
  } catch {
    return '=== BRAND PROFILE ===\nNot available.';
  }
}

// ── Calculated Reports gatherer ───────────────────────────────────────────────

async function gatherCalculatedReports(_sheets: GoogleSheetsService, databaseId: string): Promise<string> {
  try {
    const inventorySystemId = await resolveInventorySystemId(databaseId);

    const [brandReport, revReport, yearlyRows, slowReport, monthReport, onlineMonthReport, onlineBrandReport, onlinePerfReport, retentionReport] = await Promise.all([
      CalcReportsRepository.getReport(inventorySystemId, 'brand-summary').catch(() => null),
      CalcReportsRepository.getReport(inventorySystemId, 'revenue-per-branch').catch(() => null),
      YearlyRevenueRepository.list(inventorySystemId).catch(() => [] as any[]),
      CalcReportsRepository.getReport(inventorySystemId, 'slow-sellers').catch(() => null),
      CalcReportsRepository.getReport(inventorySystemId, 'sales-by-month').catch(() => null),
      CalcReportsRepository.getReport(inventorySystemId, 'online-sales-by-month').catch(() => null),
      CalcReportsRepository.getReport(inventorySystemId, 'online-top-brands').catch(() => null),
      CalcReportsRepository.getReport(inventorySystemId, 'online-performance').catch(() => null),
      CalcReportsRepository.getReport(inventorySystemId, 'monthly-retention').catch(() => null),
    ]);

    const pf = (v: unknown) => `$${parseFloat(String(v || '0')).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`;
    const lines: string[] = ['=== CALCULATED DATA REPORTS ==='];
    const savedAt = (brandReport as any)?.savedAt ?? (revReport as any)?.savedAt ?? 'N/A';
    lines.push(`Last updated: ${savedAt}`);

    if ((brandReport as any)?.rows?.length) {
      lines.push('', '--- Brand Summary (All Sales Channels, GST exc.) ---');
      lines.push('Brand | SKUs | Total Qty | Total Cost | Avg Margin | Sales 90d | Sales 180d | Sales 365d');
      for (const r of (brandReport as any).rows) {
        const [brand, skus, qty, cost, s90, s180, s365, margin] = r;
        lines.push(`${brand} | ${skus} | ${qty} | ${pf(cost)} | ${margin ? parseFloat(String(margin)).toFixed(1)+'%' : 'N/A'} | ${pf(s90)} | ${pf(s180)} | ${pf(s365)}`);
      }
    }
    if ((revReport as any)?.rows?.length) {
      lines.push('', '--- Revenue by Branch (All Sales Channels, GST exc.) ---');
      lines.push('Branch | Revenue 90d | Revenue 180d | Revenue 365d');
      for (const r of (revReport as any).rows) lines.push(`${r[0]} | ${pf(r[1])} | ${pf(r[2])} | ${pf(r[3])}`);
    }
    if (yearlyRows.length > 0) {
      const branches = new Map<string, Record<string, string>>();
      for (const row of yearlyRows) {
        const b = (row as any).extra_json?.branch ?? 'Total';
        if (!branches.has(b)) branches.set(b, { branch: b });
        branches.get(b)![String((row as any).year)] = String(Number((row as any).revenue).toFixed(2));
      }
      const yearKeys = [...new Set(yearlyRows.map((r: any) => String(r.year)))].sort().reverse();
      lines.push('', '--- Yearly Revenue by Branch ---');
      lines.push(`Branch | ${yearKeys.join(' | ')}`);
      for (const [branch, periods] of branches) lines.push(`${branch} | ${yearKeys.map(y => periods[y] || '—').join(' | ')}`);
    }
    if ((slowReport as any)?.rows?.length) {
      lines.push('', '--- Slowest Sellers ---', 'Name | Code | Brand | SOH | Sales 90d | Created');
      for (const r of (slowReport as any).rows) lines.push(`${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${pf(r[4])} | ${r[5]}`);
    }
    if ((monthReport as any)?.rows?.length) {
      lines.push('', '--- Sales by Month ---', 'Month | Revenue');
      for (const r of (monthReport as any).rows) lines.push(`${r[0]} | ${pf(r[1])}`);
    }
    if ((onlineMonthReport as any)?.rows?.length) {
      lines.push('', '--- Online Sales by Month ---', 'Month | Revenue');
      for (const r of (onlineMonthReport as any).rows) lines.push(`${r[0]} | ${pf(r[1])}`);
    }
    if ((onlineBrandReport as any)?.rows?.length) {
      lines.push('', '--- Online Top 20 Brands ---', 'Brand | Revenue | Qty | Orders');
      for (const r of (onlineBrandReport as any).rows) lines.push(`${r[0]} | ${pf(r[1])} | ${r[2]} | ${r[3]}`);
    }
    if ((onlinePerfReport as any)?.conversionRate != null) {
      const cr = parseFloat(String((onlinePerfReport as any).conversionRate));
      lines.push('', '--- Online Store Performance ---');
      lines.push(`Conversion Rate (last 90d): ${cr.toFixed(2)}% (${Math.round(Number((onlinePerfReport as any).totalConversions))} purchases from ${Number((onlinePerfReport as any).totalSessions).toLocaleString()} sessions)`);
    }
    if ((retentionReport as any)?.rows?.length) {
      lines.push('', '--- Online Customer Retention by Month ---', 'Month | Total Orders | Repeat Orders | Retention Rate');
      for (const r of (retentionReport as any).rows) lines.push(`${r[0]} | ${r[1]} | ${r[2]} | ${parseFloat(String(r[3] || '0')).toFixed(1)}%`);
    }
    if (lines.length <= 2) return '=== CALCULATED DATA REPORTS ===\nNo report data saved yet.';
    return lines.join('\n');
  } catch {
    return '=== CALCULATED DATA REPORTS ===\nNot available.';
  }
}

// ── RAW CSV fetchers (no summaries — full data as CSV rows) ──────────────────

// Rows <= this threshold are inlined as CSV text in the prompt; above → Gemini File API
const INLINE_THRESHOLD = 500;
const MAX_INLINE_ROWS = 220;
const MAX_CELL_CHARS = 500;
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_CHARS = 12000;
const MAX_PREVIOUS_CHAT_SUMMARY_CHARS = 5000;

async function fetchProductsRaw(_sheets: GoogleSheetsService, inventorySystemId: string): Promise<string[][]> {
  try {
    const products = await ProductsRepository.list(inventorySystemId);
    if (!products.length) return [];
    const headers = ['code','name','brand','cost','retail_price','global_soh','global_available','sales_revenue_90d','sales_revenue_180d','sales_revenue_12m','created_date'];
    const rows = products.map(p => {
      return [p.code??'', p.name??'', p.brand??'', String(p.cost??''), String(p.retail_price??''),
        String(p.global_soh??''), String(p.global_available??''), String(p.sales_revenue_90d??''),
        String(p.sales_revenue_180d??''), String(p.sales_revenue_12m??''), String(p.created_date??'')];
    });
    return [headers, ...rows];
  } catch { return []; }
}

async function fetchSalesRaw(_sheets: GoogleSheetsService, inventorySystemId: string): Promise<string[][]> {
  try {
    const oneYearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
    const sales = await SalesRepository.query(inventorySystemId, { from: oneYearAgo });
    if (!sales.length) return [];
    const headers = ['order_id','invoice_date','branch_id','product_name','product_option_id','qty','line_total'];
    const rows = sales.map(r => [r.order_id??'', r.invoice_date??'', r.branch_id??'', r.name??'', r.product_option_id??'', String(r.qty??''), String(r.line_total??'')]);
    return [headers, ...rows];
  } catch { return []; }
}

async function fetchWebsiteRaw(sheets: GoogleSheetsService, databaseId: string): Promise<string[][]> {
  try {
    const conn = await ConnectionsRepository.get(databaseId);
    const wsId = (conn as any)?.website_sheet_id;
    if (!wsId) return [];
    return (await sheets.getData(wsId, 'Shopify_Products') as string[][]) ?? [];
  } catch { return []; }
}

async function fetchWebsiteCollectionsRaw(sheets: GoogleSheetsService, databaseId: string): Promise<string[][]> {
  try {
    const conn = await ConnectionsRepository.get(databaseId);
    const wsId = (conn as any)?.website_sheet_id;
    if (!wsId) return [];
    return (await sheets.getData(wsId, 'Shopify_Collections') as string[][]) ?? [];
  } catch { return []; }
}

async function fetchGoogleAdsRaw(): Promise<string[][]> {
  try {
    const ads = new GoogleAdsService();
    if (!ads.customerId) return [];
    const today = new Date();
    const monthAgo = new Date(); monthAgo.setDate(today.getDate() - 30);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const metrics = await ads.getLivePerformanceMetrics(fmt(monthAgo), fmt(today)) as any[];
    if (!metrics?.length) return [];
    const headers = ['campaign_name', 'spend', 'clicks', 'conversions', 'conversions_value'];
    const rows = metrics.map(m => [
      m.campaign?.name ?? '',
      m.metrics?.cost_micros != null ? (m.metrics.cost_micros / 1_000_000).toFixed(2) : '',
      String(m.metrics?.clicks ?? ''),
      String(m.metrics?.conversions ?? ''),
      String(m.metrics?.conversions_value ?? ''),
    ]);
    return [headers, ...rows];
  } catch { return []; }
}

async function fetchMetaAdsRaw(metaToken: string, metaAccountId: string): Promise<string[][]> {
  if (!metaToken || !metaAccountId) return [];
  try {
    const accountId = metaAccountId.startsWith('act_') ? metaAccountId : `act_${metaAccountId}`;
    const meta = new MetaAdsService(metaToken, accountId);
    const insights = await meta.getLivePerformanceMetrics('last_90d') as any[];
    if (!insights?.length) return [];
    const keyMap: Record<string, true> = {};
    insights.forEach((r: any) => {
      Object.keys(r ?? {}).forEach(k => {
        keyMap[k] = true;
      });
    });
    const allKeys = Object.keys(keyMap);
    const rows = insights.map((r: any) => allKeys.map(k => {
      const v = r[k];
      return Array.isArray(v) ? JSON.stringify(v) : String(v ?? '');
    }));
    return [allKeys, ...rows];
  } catch { return []; }
}

async function fetchAnalyticsRaw(ga4PropertyId: string): Promise<string[][]> {
  if (!ga4PropertyId) return [];
  try {
    const ga = new GoogleAnalyticsService(ga4PropertyId);
    const data = await ga.getRecentPerformance();
    if (!data?.length) return [];
    const headers = ['date', 'sessions', 'conversions', 'revenue'];
    const rows = data.map(r => [r.date ?? '', String(r.sessions), String(r.conversions), String(r.revenue)]);
    return [headers, ...rows];
  } catch { return []; }
}

async function fetchApiSpec(sheets: GoogleSheetsService, specSheetId: string, apiKey: string): Promise<string | null> {
  try {
    const rows = await sheets.getData(specSheetId, 'APIInstructions!A:E') as string[][];
    if (!rows || rows.length < 2) return null;
    const match = rows.slice(1).find(r => r[0] === apiKey);
    return match?.[4] ?? null; // column E = SpecJson stored by build-api-schema
  } catch { return null; }
}

async function fetchPreviousChatSummaryContext(
  _sheets: GoogleSheetsService,
  databaseId: string,
): Promise<string> {
  try {
    const entries = await ChatsRepository.recent(databaseId, 50);
    const summaries = entries.filter(e => e.role === 'system' && e.context_json?.type === 'summary');
    if (summaries.length === 0) return '=== PREVIOUS CHAT SUMMARIES ===\nNo saved chat summaries yet.';

    const recent = summaries.slice(-10);
    const lines: string[] = ['=== PREVIOUS CHAT SUMMARIES ==='];
    let remaining = MAX_PREVIOUS_CHAT_SUMMARY_CHARS;
    for (const entry of recent) {
      if (remaining <= 0) break;
      const savedAt = (entry.created_at ?? '').slice(0, 10) || 'unknown-date';
      const summary = entry.content.trim().slice(0, 280);
      const meta = entry.context_json ?? {};
      const tags: string[] = [];
      if (meta.inventoryManagement) tags.push('Inventory');
      if (meta.marketing) tags.push('Marketing');
      if (meta.businessStrategy) tags.push('Business Strategy');
      if (meta.websiteManagement) tags.push('Website Management');
      const line = `- ${savedAt} | ${tags.length ? tags.join(', ') : 'General'} | ${summary}`;
      lines.push(line);
      remaining -= line.length;
    }
    return lines.join('\n');
  } catch {
    return '=== PREVIOUS CHAT SUMMARIES ===\nCould not load saved chat summaries.';
  }
}

function trimRowsForInlineContext(rows: string[][]): string[][] {
  if (!rows || rows.length === 0) return [];
  const header = rows[0] ?? [];
  const body = rows.slice(1).map(r => r.map(c => String(c ?? '').slice(0, MAX_CELL_CHARS)));
  const limited = body.slice(0, MAX_INLINE_ROWS);
  return [header.map(c => String(c ?? '').slice(0, MAX_CELL_CHARS)), ...limited];
}

function trimChatHistory(history: ChatHistoryItem[]): ChatHistoryItem[] {
  const recent = history.slice(-MAX_HISTORY_MESSAGES);
  let total = 0;
  const kept: ChatHistoryItem[] = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const msg = recent[i];
    const content = msg.content.slice(0, 1200);
    total += content.length;
    if (total > MAX_HISTORY_CHARS) break;
    kept.push({ role: msg.role, content });
  }
  return kept.reverse();
}

function isTokenLimitError(err: any): boolean {
  const text = `${err?.message ?? ''} ${JSON.stringify(err ?? {})}`.toLowerCase();
  // Only treat as token limit if the message explicitly mentions token counts.
  // Do NOT match all 'invalid_argument' errors — a bad model name also returns
  // INVALID_ARGUMENT but is a completely different problem.
  return text.includes('input token count exceeds') || text.includes('maximum number of tokens') || text.includes('token limit');
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

function sheetToCsv(rows: string[][]): string {
  return rows
    .map(r => r.map(cell => `"${(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

async function uploadFileToGemini(ai: GoogleGenAI, content: string, filename: string, mimeType: string): Promise<string | null> {
  try {
    const blob = new Blob([content], { type: mimeType });
    const uploaded = await ai.files.upload({ file: blob, config: { displayName: filename, mimeType } });
    const name: string = (uploaded as any).name;
    if (!name) return (uploaded as any).uri ?? null;

    // Poll until the file leaves PROCESSING state (large files can take several seconds)
    const MAX_POLLS = 20;
    const POLL_INTERVAL_MS = 3000;
    for (let i = 0; i < MAX_POLLS; i++) {
      try {
        const info = await (ai.files as any).get(name);
        const state: string = info?.state || 'PROCESSING';
        const uri: string = info?.uri;
        
        console.log(`[ai/ask] File ${filename} state=${state} uri=${uri ? 'present' : 'missing'}`);
        
        if (state === 'ACTIVE' && uri) {
          console.log(`[ai/ask] File ${filename} ACTIVE and ready`);
          return uri;
        }
        
        if (state === 'FAILED') {
          console.error(`[ai/ask] File ${filename} processing FAILED`);
          return null;
        }
        
        if (state === 'PROCESSING' || state === 'PENDING') {
          console.log(`[ai/ask] File ${filename} still ${state}, waiting ${POLL_INTERVAL_MS}ms...`);
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
        
        // Unknown state, but we have a URI - use it
        if (uri) {
          console.log(`[ai/ask] File ${filename} state=${state} (unknown), returning URI`);
          return uri;
        }
        
        console.warn(`[ai/ask] File ${filename} state=${state} but no URI, retrying...`);
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      } catch (pollErr) {
        console.warn(`[ai/ask] Error polling file status for ${filename}:`, pollErr);
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }
    }
    
    console.error(`[ai/ask] Timed out after ${MAX_POLLS * POLL_INTERVAL_MS}ms waiting for ${filename}`);
    return null;
  } catch (e) {
    console.warn(`[ai/ask] File upload failed for ${filename}:`, e);
    return null;
  }
}

async function uploadCsvToGemini(ai: GoogleGenAI, rows: string[][], displayName: string): Promise<string | null> {
  if (!rows || rows.length <= 1) return null;
  return uploadFileToGemini(ai, sheetToCsv(rows), displayName, 'text/csv');
}

// ── Prompt assembly ───────────────────────────────────────────────────────────

function buildPrompt(
  userPrompt: string,
  textSections: string[],
  inlineCsvs: { label: string; rows: string[][] }[],
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): string {
  const parts = [SYSTEM_PROMPT, '', '--- BUSINESS DATA ---', ...textSections.filter(Boolean)];
  for (const { label, rows } of inlineCsvs) {
    parts.push('', `=== ${label.toUpperCase()} (${(rows.length - 1).toLocaleString()} rows) ===`);
    parts.push(sheetToCsv(rows));
  }
  if (history.length > 0) {
    parts.push('', '--- CURRENT SESSION CHAT HISTORY ---');
    for (const msg of history) {
      const speaker = msg.role === 'assistant' ? 'Professor KnowItAll' : 'The Business';
      parts.push(`${speaker}: ${msg.content}`);
    }
  }
  parts.push('', '--- USER QUESTION ---', userPrompt);
  return parts.join('\n');
}

// ── Route handler ─────────────────────────────────────────────────────────────

type DataSourceId = 'businessInfo' | 'brandProfile' | 'products' | 'sales' | 'googleAds' | 'metaAds' | 'analytics' | 'website' | 'websiteCollections' | 'cin7Api' | 'googleAdsApi' | 'metaApi' | 'calculatedReports';

const TEXT_SOURCES = new Set<DataSourceId>(['businessInfo', 'brandProfile', 'calculatedReports']);

// JSON API spec sources — fetched from APIInstructions col E, uploaded as JSON files to Gemini
const JSON_API_SPECS: Record<string, { label: string; filename: string; apiKey: string }> = {
  cin7Api:      { label: 'Cin7 OpenAPI Spec',        filename: 'cin7-openapi.json',       apiKey: 'cin7'        },
  googleAdsApi: { label: 'Google Ads Field Schema',  filename: 'google-ads-fields.json',  apiKey: 'google-ads'  },
  metaApi:      { label: 'Meta Marketing API Schema', filename: 'meta-ads-schema.json',   apiKey: 'meta'        },
};

const CSV_META: Record<Exclude<DataSourceId, 'businessInfo' | 'brandProfile' | 'calculatedReports' | 'cin7Api' | 'googleAdsApi' | 'metaApi'>, { label: string; filename: string }> = {
  products:           { label: 'Products Catalogue',   filename: 'products.csv'            },
  sales:              { label: 'Sales History',        filename: 'sales.csv'               },
  website:            { label: 'Website Products',     filename: 'website-products.csv'    },
  websiteCollections: { label: 'Website Collections',  filename: 'website-collections.csv' },
  googleAds:          { label: 'Google Ads',           filename: 'google-ads.csv'          },
  metaAds:            { label: 'Meta Ads',             filename: 'meta-ads.csv'            },
  analytics:          { label: 'Analytics',            filename: 'analytics.csv'           },
};

interface CsvAttachment {
  label: string;
  filename: string;
  rowCount: number;
  mode: 'empty' | 'inline' | 'file';
  csvContent: string;
}

interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });

  const { databaseId, prompt, dataSources, preview, history, rememberPreviousChats } = await req.json();
  if (!databaseId || !prompt?.trim()) {
    return NextResponse.json({ error: 'databaseId and prompt are required.' }, { status: 400 });
  }

  const chatHistory: ChatHistoryItem[] = Array.isArray(history)
    ? history
        .filter((h: any) => (h?.role === 'user' || h?.role === 'assistant') && typeof h?.content === 'string' && h.content.trim())
        .map((h: any) => ({ role: h.role, content: h.content.trim() }))
    : [];
  const trimmedChatHistory = trimChatHistory(chatHistory);

  const sheets = new GoogleSheetsService();
  let inventorySystemId = databaseId;
  let modelId = 'gemini-2.5-flash-preview-04-17';
  let metaToken = '';
  let metaAccountId = '';
  let ga4PropertyId = '';
  let businessFolderId = '';

  try {
    const [conn, configAll] = await Promise.all([
      ConnectionsRepository.get(databaseId).catch(() => null),
      ConfigRepository.getAll(databaseId).catch(() => [] as any[]),
    ]);
    const getConfig = (key: string) => (configAll as any[]).find((r: any) => r.key === key)?.value ?? '';
    if (conn) {
      const c = conn as any;
      if (c.gemini_model)       modelId       = c.gemini_model;
      if (c.ga4_property_id)    ga4PropertyId = c.ga4_property_id;
      if (c.meta_ad_account_id) metaAccountId = c.meta_ad_account_id;
      if (c.meta_access_token)  { try { metaToken = decrypt(c.meta_access_token); } catch { metaToken = c.meta_access_token; } }
    }
    const invId = getConfig('InventorySystem') || getConfig('Inventory System') || await resolveInventorySystemId(databaseId).catch(() => databaseId);
    if (invId) inventorySystemId = invId;
    businessFolderId = getConfig('FolderID');
  } catch { /* use defaults */ }

  // Global specs sheet (shared across all businesses — API instructions and schemas live there)
  const globalSpecsId = await getGlobalSpecsSheetId(sheets);

  const sourcesArray  = (Array.isArray(dataSources) ? dataSources : []) as DataSourceId[];
  const textSourceIds = sourcesArray.filter(s => TEXT_SOURCES.has(s));
  const csvSourceIds  = sourcesArray.filter(s => !TEXT_SOURCES.has(s) && !(s in JSON_API_SPECS)) as Exclude<DataSourceId, 'businessInfo' | 'brandProfile' | 'calculatedReports' | 'cin7Api' | 'googleAdsApi' | 'metaApi'>[];
  const apiSpecSourceIds = sourcesArray.filter(s => s in JSON_API_SPECS);

  const textGatherers: Record<string, () => Promise<string>> = {
    businessInfo:      () => gatherBusinessInfo(sheets, databaseId),
    brandProfile:      () => gatherBrandProfile(sheets, databaseId),
    calculatedReports: () => gatherCalculatedReports(sheets, databaseId),
  };

  const csvFetchers: Record<string, () => Promise<string[][]>> = {
    products:           () => fetchProductsRaw(sheets, inventorySystemId),
    sales:              () => fetchSalesRaw(sheets, inventorySystemId),
    website:            () => fetchWebsiteRaw(sheets, databaseId),
    websiteCollections: () => fetchWebsiteCollectionsRaw(sheets, databaseId),
    googleAds:          () => fetchGoogleAdsRaw(),
    metaAds:            () => fetchMetaAdsRaw(metaToken, metaAccountId),
    analytics:          () => fetchAnalyticsRaw(ga4PropertyId),
  };

  // Gather text sections + fetch all CSV rows in parallel
  const [textSections, csvRowArrays] = await Promise.all([
    Promise.all(textSourceIds.map(s => textGatherers[s]?.() ?? Promise.resolve(''))),
    Promise.all(csvSourceIds.map(s => csvFetchers[s]?.() ?? Promise.resolve([] as string[][]))),
  ]);

  const allTextSections = [...(textSections as string[])];
  if (rememberPreviousChats && businessFolderId) {
    allTextSections.push(await fetchPreviousChatSummaryContext(sheets, databaseId));
  }

  // Load all JSON API specs (Cin7/GoogleAds/Meta) stored in APIInstructions col E of global sheet
  const apiSpecJsons: (string | null)[] = await Promise.all(
    apiSpecSourceIds.map(s => fetchApiSpec(sheets, globalSpecsId, JSON_API_SPECS[s].apiKey))
  );

  // Classify each CSV dataset: empty / inline / file
  type CsvMode = 'empty' | 'inline' | 'file';
  const classified = csvSourceIds.map((src, i) => {
    const rawRows = (csvRowArrays[i] as string[][]) ?? [];
    const inlineRows = trimRowsForInlineContext(rawRows);
    const mode: CsvMode = rawRows.length <= 1         ? 'empty'
                        : rawRows.length <= INLINE_THRESHOLD ? 'inline'
                        :                                   'file';
    return { src, meta: CSV_META[src], rawRows, inlineRows, mode };
  });

  if (preview) {
    const inlineCsvs = classified.filter(c => c.mode === 'inline');
    const promptText = buildPrompt(
      prompt.trim(),
      allTextSections,
      inlineCsvs.map(c => ({ label: c.meta.label, rows: c.inlineRows })),
      trimmedChatHistory,
    );
    const csvAttachments: CsvAttachment[] = classified
      .map(c => ({
        label:      c.meta.label,
        filename:   c.meta.filename,
        rowCount:   c.rawRows.length - 1,
        mode:       c.mode,
        csvContent: c.mode === 'empty' ? '' : sheetToCsv(c.mode === 'inline' ? c.inlineRows : c.rawRows),
      }));
    // Append any JSON API spec attachments
    apiSpecSourceIds.forEach((srcId, i) => {
      const specJson = apiSpecJsons[i];
      if (!specJson) return;
      const meta = JSON_API_SPECS[srcId];
      let fieldCount = 0;
      try {
        const parsed = JSON.parse(specJson);
        fieldCount = Array.isArray(parsed) ? parsed.length
          : Object.keys(parsed.paths ?? parsed.fields ?? parsed).length;
      } catch { /* ignore */ }
      csvAttachments.push({
        label:      meta.label,
        filename:   meta.filename,
        rowCount:   fieldCount,
        mode:       'file',
        csvContent: specJson,
      });
    });
    return NextResponse.json({ fullPrompt: promptText, csvAttachments });
  }

  // Execute: upload file-API CSVs + JSON API specs in parallel
  const ai = new GoogleGenAI({ apiKey });
  const toInline = classified.filter(c => c.mode === 'inline');
  const toUpload = classified.filter(c => c.mode === 'file');

  const [uploadedCsvUris, uploadedSpecUris] = await Promise.all([
    Promise.all(toUpload.map(c => uploadCsvToGemini(ai, c.rawRows, c.meta.filename))),
    Promise.all(apiSpecSourceIds.map((srcId, i) => {
      const specJson = apiSpecJsons[i];
      if (!specJson) return Promise.resolve(null);
      return uploadFileToGemini(ai, specJson, JSON_API_SPECS[srcId].filename, 'application/json');
    })),
  ]);

  const successCsvFiles = toUpload
    .map((c, i) => ({ ...c, uri: uploadedCsvUris[i]! }))
    .filter(c => c.uri);
  const failedCsvFiles  = toUpload.filter((_, i) => !uploadedCsvUris[i]);

  const successSpecFiles = apiSpecSourceIds
    .map((srcId, i) => ({ meta: JSON_API_SPECS[srcId], specJson: apiSpecJsons[i], uri: uploadedSpecUris[i]! }))
    .filter(f => f.uri);
  const failedSpecFiles  = apiSpecSourceIds
    .map((srcId, i) => ({ meta: JSON_API_SPECS[srcId], specJson: apiSpecJsons[i] }))
    .filter((_, i) => !uploadedSpecUris[i] && !!apiSpecJsons[i]);

  // If a large CSV file upload fails, do not pretend the full dataset is available.
  // We include only the inline-capped subset and add explicit availability notes.
  const failedCsvAsInline = failedCsvFiles.map(f => ({
    ...f,
    mode: 'inline' as const,
    inlineRows: f.inlineRows,
  }));
  // When code execution is enabled, don't add failed-upload CSVs as inline text
  // (they take up 1M+ tokens). Instead, rely on code execution for analysis.
  const allInline = successCsvFiles.length > 0 
    ? [...toInline]  // Only keep small CSVs that were always inline
    : [...toInline, ...failedCsvAsInline];  // No code execution, so include failed uploads as fallback
  // Inline fallback text for any spec that failed to upload
  const specFallbackNote = failedSpecFiles.length > 0
    ? '\n\n=== API SPEC REFERENCES (upload failed — abridged) ===\n' +
      failedSpecFiles.map(f => `${f.meta.label}:\n${(f.specJson ?? '').slice(0, 4000)}\n[...truncated]`).join('\n\n')
    : '';
  const dataAvailabilityNote = failedCsvFiles.length > 0
    ? '\n\n=== DATA AVAILABILITY ===\n' +
      failedCsvFiles.map(f => `- ${f.meta.label}: full file upload failed; only a limited inline subset was included.`).join('\n')
    : '';
  const promptText = buildPrompt(
    prompt.trim(),
    allTextSections,
    allInline.map(c => ({ label: c.meta.label, rows: c.inlineRows })),
    trimmedChatHistory,
  ) + specFallbackNote + dataAvailabilityNote;

  const allAttachedNotes: string[] = [
    ...successCsvFiles.map(f => `${f.meta.label} (${(f.rawRows.length - 1).toLocaleString()} rows): ${f.meta.filename}`),
    ...successSpecFiles.map(f => `${f.meta.label}: ${f.meta.filename}`),
  ];
  const promptWithNotes = allAttachedNotes.length > 0
    ? promptText + '\n\n--- ATTACHED DATA FILES (READ THESE) ---\n' +
      'The following files have been attached to this message. You have code execution enabled, so write Python code (using pandas) to analyse, filter, and query these CSV files directly. Do not try to read the entire file into context—use code to extract only the relevant data you need to answer the question.\n' +
      allAttachedNotes.join('\n')
    : promptText;

  const fileParts: any[] = [
    ...successCsvFiles.map(f => ({ fileData: { mimeType: 'text/csv',         fileUri: f.uri } })),
    ...successSpecFiles.map(f => ({ fileData: { mimeType: 'application/json', fileUri: f.uri } })),
  ];

  // Auto-escalate to a 2M-token model when large files are attached and the
  // configured model only has a 1M-token context window.
  const ONE_M_PATTERN = /flash|gemini-2\.|gemini-exp/i;
  const effectiveModelId = (fileParts.length > 0 && ONE_M_PATTERN.test(modelId))
    ? 'gemini-1.5-pro'
    : modelId;
  if (effectiveModelId !== modelId) {
    console.log(`[ai/ask] Large file detected — escalating from ${modelId} to ${effectiveModelId}`);
  }

  const contents: any = fileParts.length > 0
    ? [{ role: 'user', parts: [{ text: promptWithNotes }, ...fileParts] }]
    : promptWithNotes;

  // Build request config with code execution enabled when files are attached
  // Build request with code execution enabled when files are attached
  // This allows the model to write Python code to analyse CSVs instead of tokenizing them
  const requestConfig: any = { model: effectiveModelId, contents };
  if (fileParts.length > 0) {
    requestConfig.tools = [{ codeExecution: {} }];
    console.log(`[ai/ask] Request config:`, {
      model: effectiveModelId,
      numFileParts: fileParts.length,
      textLength: typeof contents === 'string' ? contents.length : 'array-based',
      hasCodeExecution: true,
      fileUris: fileParts.map((p: any) => p.fileData?.fileUri || 'no-uri').slice(0, 3),
    });
  }

  try {
    const result = await ai.models.generateContent(requestConfig);
    // Extract text from response (handles both direct text and code execution results)
    const responseText = result.text?.trim() ?? '';
    return NextResponse.json({ response: responseText, model: effectiveModelId, fullPrompt: promptWithNotes });
  } catch (e: any) {
    if (isTokenLimitError(e)) {
      try {
        // Fallback: drop ALL file attachments and inline CSVs — use only text context + minimal history.
        // The file itself is causing the overflow; we cannot keep it.
        const fileNote = successCsvFiles.length > 0
          ? `\n\n=== DATA NOTE ===\nThe following files were too large for this model's context window and could not be included:\n` +
            successCsvFiles.map(f => `- ${f.meta.label}: ${(f.rawRows.length - 1).toLocaleString()} rows`).join('\n') +
            `\nTo analyse large catalogues, set your Gemini Model to gemini-1.5-pro in Setup > Connections.`
          : '';
        const fallbackPrompt = buildPrompt(
          prompt.trim(),
          allTextSections.filter(s => !s.startsWith('=== PREVIOUS CHAT SUMMARIES ===')),
          [],
          trimmedChatHistory.slice(-6),
        ) + fileNote;
        const fallbackRetryConfig = { model: effectiveModelId, contents: fallbackPrompt };
        const retry = await ai.models.generateContent(fallbackRetryConfig);
        const retryText = retry.text?.trim() ?? '';
        return NextResponse.json({
          response: `${retryText}\n\n[Note: The attached data file exceeded the model token limit and was not included. Switch to gemini-1.5-pro in Setup → Connections for full large-catalogue analysis.]`,
          model: effectiveModelId,
          fullPrompt: fallbackPrompt,
        });
      } catch (retryErr: any) {
        console.error('[ai/ask] Gemini token-limit retry failed:', retryErr);
        return NextResponse.json({
          error: `Context was too large even after reducing it. Try unchecking some data sources or disabling Remember Previous Chats. (${retryErr?.message ?? 'unknown error'})`,
        }, { status: 400 });
      }
    }
    // Non-token errors: surface the real message so misconfiguration (e.g. bad model name) is visible.
    console.error('[ai/ask] Gemini error:', e);
    const msg: string = e?.message ?? String(e);
    const userFacing = msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('invalid')
      ? `AI model error: ${msg} — check the Gemini Model setting in Setup → Connections.`
      : msg;
    return NextResponse.json({ error: userFacing }, { status: 500 });
  }
}
