import { NextResponse } from 'next/server';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { GoogleAdsService } from '@/services/GoogleAdsService';
import { MetaAdsService } from '@/services/MetaAdsService';
import { GoogleAnalyticsService } from '@/services/GoogleAnalyticsService';
import { GoogleGenAI } from '@google/genai';
import { decrypt } from '@/lib/encryption';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { BrandProfileRepository } from '@/lib/db/BrandProfileRepository';
import { BusinessInfoRepository } from '@/lib/db/BusinessInfoRepository';
import { ProductsRepository } from '@/lib/db/ProductsRepository';
import { SalesRepository } from '@/lib/db/SalesRepository';
import { CalcReportsRepository } from '@/lib/db/CalcReportsRepository';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';

// ── System prompt for CMO mode ─────────────────────────────────────────────────
const CMO_SYSTEM_PROMPT = `You are an elite Chief Marketing Officer (CMO) and high-level marketing strategist for a retail/e-commerce business. Your current task is strictly foundational and philosophical. You are collaborative, visionary, and grounded in proven marketing science (such as balancing long-term brand building with short-term sales activation). 

Collaborate with the human business owner to define a high-level **Marketing Mission & Philosophy Document**. 
Do NOT analyze specific campaigns, advertising metrics (like CPC or ROAS), or granular sales data at this stage. Your goal is to establish the "Rules of Engagement" and the overarching aims of all future marketing activities.

Based on the provided Business Profile (Brand Mission, Target Demographics, UVP, Pricing Strategy), generate a draft of the **Marketing Mission & Philosophy** covering the following five pillars. Present this as a draft for the user to review and tweak:

**1. Primary Marketing Aim:** 
What is the ultimate goal of the marketing department for this specific brand? (e.g., Is it aggressive market share acquisition? Is it maximizing customer lifetime value and retention? Is it positioning the brand as the premier authority in a niche?)

**2. The Marketing Mix (Brand vs. Performance):**
Define the philosophical split between short-term gains and long-term payoffs. Based on the brand's price point and buying cycle, recommend an optimal split (e.g., 60% Brand Building / 40% Sales Activation) and explain *why* this is the best practice for this specific business model.

**3. Quality & Creative Standards:**
What are the non-negotiable standards for how the brand presents itself to the world? Define the philosophy on visual quality, copywriting tone, and the emotional resonance required in ad creatives (e.g., playful, premium, accessible). 

**4. Channel Diversity & Structure:**
Outline the high-level philosophy on where the brand should be present. How do we treat top-of-funnel awareness vs. bottom-of-funnel conversion? How do we ensure we aren't overly reliant on a single platform (e.g., Meta) and maintain a healthy, diversified marketing ecosystem?

**5. Collaboration & Next Steps:**
End your response by asking the user 2 to 3 targeted, high-level questions to refine this philosophy. Ask them what feels right, what is missing, and how they personally view the balance of short-term sales vs. long-term brand equity.

Stay high-level and strategic. Do not mention specific ad sets, keywords, or granular ROAS goals. Adapt your recommendations to fit the specific business data provided by the user. Acknowledge that once this philosophy is agreed upon, Phase 2 will involve conducting a gap analysis to procure the exact data needed to execute this vision.

Return your response as a valid JSON object with the following structure:
{
  "primaryMarketingAim": "string",
  "marketingMix": {
    "brandBuildingPercent": number,
    "salesActivationPercent": number,
    "reasoning": "string"
  },
  "qualityCreativeStandards": {
    "visualTone": "string",
    "copywritingTone": "string",
    "emotionalResonance": "string"
  },
  "channelDiversity": {
    "topOfFunnelStrategy": "string",
    "bottomOfFunnelStrategy": "string",
    "diversificationPhilosophy": "string"
  },
  "nextStepsQuestions": ["question1", "question2", "question3"]
}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function nc(v: unknown): string {
  return String(v ?? '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Constants ─────────────────────────────────────────────────────────────────
const INLINE_THRESHOLD = 500;
const MAX_INLINE_ROWS = 220;
const MAX_CELL_CHARS = 500;
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_CHARS = 12000;

// ── CSV source metadata ───────────────────────────────────────────────────────
const MM_CSV_META: Record<string, { label: string; filename: string }> = {
  products:  { label: 'Products Catalogue', filename: 'products.csv'         },
  sales:     { label: 'Sales History',      filename: 'sales.csv'            },
  website:   { label: 'Website Products',   filename: 'website-products.csv' },
  googleAds: { label: 'Google Ads',         filename: 'google-ads.csv'       },
  metaAds:   { label: 'Meta Ads',           filename: 'meta-ads.csv'         },
  analytics: { label: 'Analytics',          filename: 'analytics.csv'        },
  klaviyo:   { label: 'Klaviyo Email',       filename: 'klaviyo.csv'          },
};

// ── Data gatherers ─────────────────────────────────────────────────────────────

async function gatherCalculatedReports(inventorySystemId: string): Promise<string> {
  try {
    const [brandReport, revReport, slowReport, monthReport, onlineMonthReport, onlineBrandReport, onlinePerfReport, monthlyRetReport] = await Promise.all([
      CalcReportsRepository.getReport(inventorySystemId, 'brand-summary').catch(() => null),
      CalcReportsRepository.getReport(inventorySystemId, 'revenue-per-branch').catch(() => null),
      CalcReportsRepository.getReport(inventorySystemId, 'slow-sellers').catch(() => null),
      CalcReportsRepository.getReport(inventorySystemId, 'sales-by-month').catch(() => null),
      CalcReportsRepository.getReport(inventorySystemId, 'online-sales-by-month').catch(() => null),
      CalcReportsRepository.getReport(inventorySystemId, 'online-top-brands').catch(() => null),
      CalcReportsRepository.getReport(inventorySystemId, 'online-performance').catch(() => null),
      CalcReportsRepository.getReport(inventorySystemId, 'monthly-retention').catch(() => null),
    ]);
    const lines: string[] = ['=== CALCULATED REPORTS ==='];
    if (brandReport && Array.isArray(brandReport) && brandReport.length > 0) {
      lines.push('', '--- Brand Summary (All Sales Channels, GST exc.) ---', 'Brand | SKUs | Total Qty | Total Cost | Avg Margin | Sales 90d | Sales 180d | Sales 365d');
      for (const r of brandReport) {
        const m = (v: any) => `$${parseFloat(v || '0').toLocaleString('en-AU', { minimumFractionDigits: 2 })}`;
        const marginStr = r.avgMargin != null ? `${parseFloat(r.avgMargin).toFixed(1)}%` : 'N/A';
        lines.push(`${r.brand} | ${r.skus} | ${r.qty} | ${m(r.totalCost)} | ${marginStr} | ${m(r.sales90d)} | ${m(r.sales180d)} | ${m(r.sales365d)}`);
      }
    }
    if (revReport && Array.isArray(revReport) && revReport.length > 0) {
      lines.push('', '--- Revenue by Branch (All Sales Channels, GST exc.) ---', 'Branch | Revenue 90d | Revenue 180d | Revenue 365d');
      for (const r of revReport) {
        const m = (v: any) => `$${parseFloat(v || '0').toLocaleString('en-AU', { minimumFractionDigits: 2 })}`;
        lines.push(`${r.branch} | ${m(r.revenue90d)} | ${m(r.revenue180d)} | ${m(r.revenue365d)}`);
      }
    }
    if (slowReport && Array.isArray(slowReport) && slowReport.length > 0) {
      lines.push('', '--- Slowest Sellers (All Sales Channels, GST exc.) ---', 'Name | Code | Brand | SOH | Sales 90d | Created');
      for (const r of slowReport) {
        lines.push(`${nc(r.name)} | ${nc(r.code)} | ${nc(r.brand)} | ${r.soh} | $${parseFloat(r.sales90d || '0').toLocaleString('en-AU', { minimumFractionDigits: 2 })} | ${r.created}`);
      }
    }
    if (monthReport && Array.isArray(monthReport) && monthReport.length > 0) {
      lines.push('', '--- Sales by Month (All Sales Channels, GST exc.) ---', 'Month | Revenue');
      for (const r of monthReport) {
        lines.push(`${r.month} | $${parseFloat(r.revenue || '0').toLocaleString('en-AU', { minimumFractionDigits: 2 })}`);
      }
    }
    if (onlineMonthReport && Array.isArray(onlineMonthReport) && onlineMonthReport.length > 0) {
      lines.push('', '--- Online Sales by Month (Shopify / Online Channel Only) ---', 'Month | Revenue');
      for (const r of onlineMonthReport) {
        lines.push(`${r.month} | $${parseFloat(r.revenue || '0').toLocaleString('en-AU', { minimumFractionDigits: 2 })}`);
      }
    }
    if (onlineBrandReport && Array.isArray(onlineBrandReport) && onlineBrandReport.length > 0) {
      lines.push('', '--- Online Top 20 Brands by Revenue (Shopify / Online Channel Only) ---', 'Brand | Revenue | Qty Sold | Orders');
      for (const r of onlineBrandReport) {
        lines.push(`${r.brand} | $${parseFloat(r.revenue || '0').toLocaleString('en-AU', { minimumFractionDigits: 2 })} | ${r.qty} | ${r.orders}`);
      }
    }
    if (onlinePerfReport && typeof onlinePerfReport === 'object' && !Array.isArray(onlinePerfReport)) {
      const pr = onlinePerfReport as any;
      lines.push('', '--- Online Store Performance (Shopify / Online Channel Only) ---');
      if (pr.conversionRate != null) {
        lines.push(`Conversion Rate (last 90d): ${parseFloat(pr.conversionRate).toFixed(2)}% (${Math.round(pr.purchases || 0)} purchases from ${parseInt(pr.sessions || '0', 10).toLocaleString()} sessions)`);
      } else {
        lines.push('Conversion Rate: N/A (GA4 not connected)');
      }
    }
    if (monthlyRetReport && Array.isArray(monthlyRetReport) && monthlyRetReport.length > 0) {
      lines.push('', '--- Online Customer Retention by Month (Shopify / Online Channel Only) ---', 'Month | Total Orders | Repeat Orders | Retention Rate');
      for (const r of monthlyRetReport) {
        lines.push(`${r.month} | ${r.totalOrders} | ${r.repeatOrders} | ${parseFloat(r.retentionRate || '0').toFixed(1)}%`);
      }
    }
    return lines.length > 2 ? lines.join('\n') : '';
  } catch { return ''; }
}

// ── Raw CSV fetchers ──────────────────────────────────────────────────────────

async function fetchProductsRaw(inventorySystemId: string): Promise<string[][]> {
  try {
    const products = await ProductsRepository.list(inventorySystemId);
    if (!products.length) return [];
    const headers = ['code', 'name', 'brand', 'cost', 'retail_price', 'global_soh', 'sales_revenue_90d', 'sales_revenue_180d', 'sales_revenue_12m', 'created_date'];
    const rows = products.map(p => {
      return [
        String(p.code ?? ''), String(p.name ?? ''), String(p.brand ?? ''),
        String(p.cost ?? ''), String(p.retail_price ?? ''),
        String(p.global_soh ?? ''), String(p.sales_revenue_90d ?? ''),
        String(p.sales_revenue_180d ?? ''), String(p.sales_revenue_12m ?? ''),
        String(p.created_date ?? ''),
      ];
    });
    return [headers, ...rows];
  } catch { return []; }
}

async function fetchSalesRaw(inventorySystemId: string): Promise<string[][]> {
  try {
    const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const from = oneYearAgo.toISOString().split('T')[0];
    const sales = await SalesRepository.query(inventorySystemId, { from });
    if (!sales.length) return [];
    const headers = ['order_id', 'invoice_date', 'branch_id', 'product_name', 'qty', 'line_total'];
    const rows = sales.map(s => [
      String(s.order_id ?? ''), String(s.invoice_date ?? ''),
      String(s.branch_id ?? ''), String(s.name ?? ''),
      String(s.qty ?? ''), String(s.line_total ?? ''),
    ]);
    return [headers, ...rows];
  } catch { return []; }
}

async function fetchWebsiteRaw(databaseId: string): Promise<string[][]> {
  try {
    const conn = await ConnectionsRepository.get(databaseId).catch(() => null);
    const wsId = conn?.website_sheet_id;
    if (!wsId) return [];
    const sheets = new GoogleSheetsService();
    return (await sheets.getData(wsId, 'Shopify_Products') as string[][]) ?? [];
  } catch { return []; }
}

async function fetchGoogleAdsRaw(): Promise<string[][]> {
  try {
    const ads = new GoogleAdsService();
    if (!ads.customerId) return [];
    const today = new Date();
    const monthAgo = new Date(); monthAgo.setDate(today.getDate() - 30);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    // Use getCampaigns so we get channel type + bidding strategy — needed for funnel coverage audit
    const campaigns = await ads.getCampaigns(fmt(monthAgo), fmt(today)) as any[];
    if (!campaigns?.length) return [];
    const headers = ['campaign_name', 'channel_type', 'bidding_strategy', 'daily_budget', 'impressions', 'clicks', 'spend', 'conversions', 'conversions_value', 'ctr', 'avg_cpc'];
    const rows = campaigns.map((c: any) => [
      c.campaign?.name ?? '',
      c.campaign?.advertising_channel_type ?? '',
      c.campaign?.bidding_strategy_type ?? '',
      c.campaign_budget?.amount_micros != null ? (Number(c.campaign_budget.amount_micros) / 1_000_000).toFixed(2) : '',
      String(c.metrics?.impressions ?? ''),
      String(c.metrics?.clicks ?? ''),
      c.metrics?.cost_micros != null ? (Number(c.metrics.cost_micros) / 1_000_000).toFixed(2) : '',
      String(c.metrics?.conversions ?? ''),
      String(c.metrics?.conversions_value ?? ''),
      c.metrics?.ctr != null ? String(c.metrics.ctr) : '',
      c.metrics?.average_cpc != null ? (Number(c.metrics.average_cpc) / 1_000_000).toFixed(2) : '',
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
    insights.forEach((r: any) => { Object.keys(r ?? {}).forEach(k => { keyMap[k] = true; }); });
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
    const today = new Date().toISOString().split('T')[0];
    const ninetyDaysAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().split('T')[0]; })();
    // Channel-level breakdown — critical for funnel coverage audit (organic vs paid vs social vs email vs direct)
    return await ga.runReport(
      ['sessionDefaultChannelGroup', 'sessionSource', 'sessionMedium'],
      ['sessions', 'newUsers', 'engagementRate', 'conversions', 'totalRevenue'],
      ninetyDaysAgo,
      today,
    );
  } catch { return []; }
}

async function fetchKlaviyoRaw(apiKey: string): Promise<string[][]> {
  if (!apiKey) return [];
  try {
    const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
    const h = { Authorization: `Klaviyo-API-Key ${apiKey}`, revision: '2024-10-15' };
    const [campRes, flowRes] = await Promise.all([
      fetch(`${KLAVIYO_BASE}/campaigns/?filter=equals(messages.channel,'email')&page[size]=50&sort=-created_at`, { headers: h }),
      fetch(`${KLAVIYO_BASE}/flows/?page[size]=50&sort=-created`, { headers: h }),
    ]);
    const campData: any[] = campRes.ok ? ((await campRes.json()).data ?? []) : [];
    const flowData: any[] = flowRes.ok ? ((await flowRes.json()).data ?? []) : [];
    if (!campData.length && !flowData.length) return [];
    const rows: string[][] = [['type', 'name', 'status', 'trigger_type', 'archived', 'send_time', 'created', 'updated']];
    for (const c of campData) {
      const a = c.attributes ?? {};
      rows.push(['campaign', a.name ?? '', a.status ?? '', '', String(a.archived ?? false), a.send_time ?? '', a.created_at ?? '', a.updated_at ?? '']);
    }
    for (const f of flowData) {
      const a = f.attributes ?? {};
      rows.push(['flow', a.name ?? '', a.status ?? '', a.trigger_type ?? '', String(a.archived ?? false), '', a.created ?? '', a.updated ?? '']);
    }
    return rows;
  } catch { return []; }
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
    const MAX_POLLS = 20;
    const POLL_INTERVAL_MS = 3000;
    for (let i = 0; i < MAX_POLLS; i++) {
      try {
        const info = await (ai.files as any).get(name);
        const state: string = info?.state || 'PROCESSING';
        const uri: string = info?.uri;
        console.log(`[ai/marketing-mission] File ${filename} state=${state}`);
        if (state === 'ACTIVE' && uri) return uri;
        if (state === 'FAILED') { console.error(`[ai/marketing-mission] File ${filename} FAILED`); return null; }
        if (uri && state !== 'PROCESSING' && state !== 'PENDING') return uri;
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      } catch (pollErr) {
        console.warn(`[ai/marketing-mission] Error polling ${filename}:`, pollErr);
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }
    }
    console.error(`[ai/marketing-mission] Timed out waiting for ${filename}`);
    return null;
  } catch (e) {
    console.warn(`[ai/marketing-mission] File upload failed for ${filename}:`, e);
    return null;
  }
}

async function uploadCsvToGemini(ai: GoogleGenAI, rows: string[][], displayName: string): Promise<string | null> {
  if (!rows || rows.length <= 1) return null;
  return uploadFileToGemini(ai, sheetToCsv(rows), displayName, 'text/csv');
}

function trimRowsForInlineContext(rows: string[][]): string[][] {
  if (!rows || rows.length === 0) return [];
  const header = (rows[0] ?? []).map(c => String(c ?? '').slice(0, MAX_CELL_CHARS));
  const body = rows.slice(1).map(r => r.map(c => String(c ?? '').slice(0, MAX_CELL_CHARS)));
  return [header, ...body.slice(0, MAX_INLINE_ROWS)];
}

interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
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
  return text.includes('input token count exceeds') || text.includes('maximum number of tokens') || text.includes('token limit');
}

// ── Prompt assembly ───────────────────────────────────────────────────────────

function buildMMPrompt(
  userPrompt: string,
  textSections: string[],
  inlineCsvs: { label: string; rows: string[][] }[],
  history: ChatHistoryItem[],
): string {
  const parts = ['--- BUSINESS DATA ---', ...textSections.filter(Boolean)];
  for (const { label, rows } of inlineCsvs) {
    parts.push('', `=== ${label.toUpperCase()} (${(rows.length - 1).toLocaleString()} rows) ===`);
    parts.push(sheetToCsv(rows));
  }
  if (history.length > 0) {
    parts.push('', '--- PREVIOUS CONVERSATION ---');
    for (const msg of history) {
      const speaker = msg.role === 'assistant' ? 'CMO' : 'Business Owner';
      parts.push(`${speaker}: ${msg.content}`);
    }
  }
  parts.push('', '--- CURRENT REQUEST ---', userPrompt);
  parts.push('', 'Respond as the CMO. If the user is asking you to generate or refine the complete marketing mission document, return a JSON object. Otherwise, provide strategic guidance in conversational text.');
  return parts.join('\n');
}

async function gatherBrandProfile(databaseId: string): Promise<string> {
  try {
    const p = await BrandProfileRepository.get(databaseId);
    if (!p) return '=== BRAND PROFILE ===\nNot configured.';
    const fields: [string, string | null][] = [
      ['Brand Mission',            p.mission],
      ['Unique Value Proposition', p.uvp],
      ['Brand Tone & Voice',       p.tone],
      ['Target Demographics',      p.demographics],
      ['Top Geographies',          p.geo],
      ['Hero Products',            p.hero_products],
      ['Price Positioning & AOV',  p.price_positioning],
      ['Core Customer Praises',    p.praises],
      ['Core Objections',          p.objections],
      ['Primary Competitors',      p.competitors],
      ['Market Gap',               p.market_gap],
      ['Logo URL',                 p.logo_url],
      ['Brand Colours',            p.brand_colours],
      ['Shipping Policy',          p.shipping_policy],
      ['Connected Software',       p.connected_software],
      ['Business Operations Summary', p.operations_summary],
      ['Returns Policy',           p.returns_policy],
      ['Brand History',            p.brand_history],
      ['Physical Branches',        p.physical_branches],
      ['Loyalty Program',          p.loyalty_program],
    ];
    const lines = ['=== BRAND PROFILE ==='];
    for (const [label, val] of fields) {
      if (val?.trim()) lines.push(`${label}: ${val.trim()}`);
    }
    return lines.join('\n');
  } catch {
    return '=== BRAND PROFILE ===\nNot available.';
  }
}

async function gatherBusinessInfo(databaseId: string): Promise<string> {
  try {
    const b = await BusinessInfoRepository.get(databaseId);
    if (!b) return '=== BUSINESS INFORMATION ===\nNot configured.';
    return [
      '=== BUSINESS INFORMATION ===',
      `Brand Name: ${b.brand_name || 'N/A'}`,
      `Website: ${b.brand_url || 'N/A'}`,
      `Years in Business: ${b.years_in_business || 'N/A'}`,
      `Facebook: ${b.facebook_link || 'N/A'}`,
      `Instagram: ${b.instagram_link || 'N/A'}`,
      `Pinterest: ${b.pinterest_link || 'N/A'}`,
    ].join('\n');
  } catch {
    return '=== BUSINESS INFORMATION ===\nNot available.';
  }
}

export async function POST(req: Request) {
  try {
    const { user, response } = requireAdminSession();
    if (response) return response;

    const body = await req.json();
    const { databaseId, prompt, history = [], dataSources = [], preview = false } = body;

    if (!databaseId || !prompt) {
      return NextResponse.json({ error: 'Missing databaseId or prompt' }, { status: 400 });
    }
    const denied = assertBusinessAccess(user, databaseId);
    if (denied) return denied;

    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });

    let modelId = 'gemini-2.5-flash-preview-04-17';
    let metaToken = '';
    let metaAccountId = '';
    let ga4PropertyId = '';
    let klaviyoApiKey = '';
    let inventorySystemId = databaseId;

    try {
      const [conn, resolvedInvId] = await Promise.all([
        ConnectionsRepository.get(databaseId).catch(() => null),
        resolveInventorySystemId(databaseId).catch(() => databaseId),
      ]);
      if (conn) {
        if (conn.gemini_model)           modelId       = conn.gemini_model;
        if (conn.ga4_property_id)        ga4PropertyId = conn.ga4_property_id;
        if (conn.meta_ad_account_id)     metaAccountId = conn.meta_ad_account_id;
        if (conn.meta_access_token)      { try { metaToken     = decrypt(conn.meta_access_token); } catch { metaToken     = conn.meta_access_token; } }
        if (conn.klaviyo_api_key)        { try { klaviyoApiKey = decrypt(conn.klaviyo_api_key);   } catch { klaviyoApiKey = conn.klaviyo_api_key;   } }
      }
      inventorySystemId = resolvedInvId;
    } catch { /* use defaults */ }

    const chatHistory: ChatHistoryItem[] = Array.isArray(history)
      ? history
          .filter((h: any) => (h?.role === 'user' || h?.role === 'assistant') && typeof h?.content === 'string' && h.content.trim())
          .map((h: any) => ({ role: h.role as 'user' | 'assistant', content: h.content.trim() }))
      : [];
    const trimmedHistory = trimChatHistory(chatHistory);

    const enabledSources = Array.isArray(dataSources) ? dataSources as string[] : [];
    const csvSourceIds = Object.keys(MM_CSV_META).filter(s => enabledSources.includes(s));

    // Always include businessInfo + brandProfile; calculatedReports when 'reports' is enabled
    const [businessInfo, brandProfile, calculatedReports] = await Promise.all([
      gatherBusinessInfo(databaseId),
      gatherBrandProfile(databaseId),
      enabledSources.includes('reports') ? gatherCalculatedReports(inventorySystemId) : Promise.resolve(''),
    ]);
    const textSections = [businessInfo, brandProfile, calculatedReports].filter(Boolean);

    // Fetch raw CSV rows in parallel
    const csvFetchers: Record<string, () => Promise<string[][]>> = {
      products:  () => fetchProductsRaw(inventorySystemId),
      sales:     () => fetchSalesRaw(inventorySystemId),
      website:   () => fetchWebsiteRaw(databaseId),
      googleAds: () => fetchGoogleAdsRaw(),
      metaAds:   () => fetchMetaAdsRaw(metaToken, metaAccountId),
      analytics: () => fetchAnalyticsRaw(ga4PropertyId),
      klaviyo:   () => fetchKlaviyoRaw(klaviyoApiKey),
    };
    const csvRowArrays = await Promise.all(
      csvSourceIds.map(s => csvFetchers[s]?.() ?? Promise.resolve([] as string[][]))
    );

    // Classify each CSV: empty / inline / file
    type CsvMode = 'empty' | 'inline' | 'file';
    const classified = csvSourceIds.map((src, i) => {
      const rawRows = (csvRowArrays[i] as string[][]) ?? [];
      const inlineRows = trimRowsForInlineContext(rawRows);
      const mode: CsvMode = rawRows.length <= 1               ? 'empty'
                          : rawRows.length <= INLINE_THRESHOLD ? 'inline'
                          :                                      'file';
      return { src, meta: MM_CSV_META[src], rawRows, inlineRows, mode };
    });

    if (preview) {
      const inlineCsvs = classified.filter(c => c.mode === 'inline');
      const promptText = buildMMPrompt(
        prompt.trim(),
        textSections,
        inlineCsvs.map(c => ({ label: c.meta.label, rows: c.inlineRows })),
        trimmedHistory,
      );
      const csvAttachments = classified.map(c => ({
        label:      c.meta.label,
        filename:   c.meta.filename,
        rowCount:   Math.max(0, c.rawRows.length - 1),
        mode:       c.mode,
        csvContent: c.mode === 'empty' ? '' : sheetToCsv(c.mode === 'inline' ? c.inlineRows : c.rawRows),
      }));
      return NextResponse.json({ fullPrompt: promptText, csvAttachments });
    }

    // Upload large CSVs to Gemini File API; inline small ones
    const ai = new GoogleGenAI({ apiKey });
    const toInline = classified.filter(c => c.mode === 'inline');
    const toUpload = classified.filter(c => c.mode === 'file');

    const uploadedUris = await Promise.all(
      toUpload.map(c => uploadCsvToGemini(ai, c.rawRows, c.meta.filename))
    );

    const successFiles = toUpload.map((c, i) => ({ ...c, uri: uploadedUris[i]! })).filter(c => c.uri);
    const failedFiles  = toUpload.filter((_, i) => !uploadedUris[i]);

    // If uploads fail, fall back to inline (capped). With code execution active, skip large-file inline.
    const allInline = successFiles.length > 0
      ? [...toInline]
      : [...toInline, ...failedFiles.map(f => ({ ...f, mode: 'inline' as const }))];

    const dataAvailabilityNote = failedFiles.length > 0
      ? '\n\n=== DATA AVAILABILITY ===\n' +
        failedFiles.map(f => `- ${f.meta.label}: file upload failed; only a limited inline subset was included.`).join('\n')
      : '';

    const allAttachedNotes = successFiles.map(f =>
      `${f.meta.label} (${(f.rawRows.length - 1).toLocaleString()} rows): ${f.meta.filename}`
    );

    const promptText = buildMMPrompt(
      prompt.trim(),
      textSections,
      allInline.map(c => ({ label: c.meta.label, rows: c.inlineRows })),
      trimmedHistory,
    ) + dataAvailabilityNote;

    const promptWithNotes = allAttachedNotes.length > 0
      ? promptText + '\n\n--- ATTACHED DATA FILES (READ THESE) ---\n' +
        'The following files have been attached to this message. You have code execution enabled, so write Python code (using pandas) to analyse, filter, and query these CSV files directly. Do not try to read the entire file into context — use code to extract only the relevant data you need.\n' +
        allAttachedNotes.join('\n')
      : promptText;

    const fileParts: any[] = successFiles.map(f => ({ fileData: { mimeType: 'text/csv', fileUri: f.uri } }));

    // Auto-escalate to 2M-token model when large files are attached
    const ONE_M_PATTERN = /flash|gemini-2\.|gemini-exp/i;
    const effectiveModelId = (fileParts.length > 0 && ONE_M_PATTERN.test(modelId))
      ? 'gemini-1.5-pro'
      : modelId;
    if (effectiveModelId !== modelId) {
      console.log(`[ai/marketing-mission] Large file — escalating from ${modelId} to ${effectiveModelId}`);
    }

    const contents: any = fileParts.length > 0
      ? [{ role: 'user', parts: [{ text: promptWithNotes }, ...fileParts] }]
      : promptWithNotes;

    const requestConfig: any = { model: effectiveModelId, contents, systemInstruction: CMO_SYSTEM_PROMPT };
    if (fileParts.length > 0) {
      requestConfig.tools = [{ codeExecution: {} }];
      console.log(`[ai/marketing-mission] Code execution enabled, ${fileParts.length} file(s) attached`);
    }

    const parseMission = (text: string): { mission: any; responseText: string } => {
      try {
        const jsonMatch = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || text.match(/({[\s\S]*})/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          // 5-pillar format
          if (parsed.primaryMarketingAim && parsed.marketingMix && parsed.qualityCreativeStandards && parsed.channelDiversity) {
            return { mission: parsed, responseText: text.split('```')[0].trim() || 'Marketing mission generated successfully.' };
          }
          // Comprehensive format
          if ((parsed.executive_summary || parsed.brand_identity || parsed.document_title) && parsed.strategic_objectives) {
            return { mission: parsed, responseText: text.split('```')[0].trim() || 'Marketing mission generated successfully.' };
          }
        }
      } catch { /* not JSON */ }
      return { mission: null, responseText: text };
    };

    try {
      const result = await ai.models.generateContent(requestConfig);
      const text = result.text?.trim() ?? '';
      const { mission, responseText } = parseMission(text);
      return NextResponse.json({ response: responseText, mission, model: effectiveModelId });
    } catch (e: any) {
      if (isTokenLimitError(e)) {
        try {
          const fallbackPrompt = buildMMPrompt(prompt.trim(), textSections, [], trimmedHistory.slice(-6));
          const fallbackResult = await ai.models.generateContent({ model: effectiveModelId, contents: fallbackPrompt, systemInstruction: CMO_SYSTEM_PROMPT } as any);
          const fallbackText = fallbackResult.text?.trim() ?? '';
          const { mission, responseText } = parseMission(fallbackText);
          return NextResponse.json({
            response: `${responseText}\n\n[Note: Attached data files exceeded the model token limit and were not included.]`,
            mission,
            model: effectiveModelId,
          });
        } catch (retryErr: any) {
          return NextResponse.json({
            error: `Context was too large even after reducing it. Try unchecking some data sources. (${retryErr?.message ?? 'unknown error'})`,
          }, { status: 400 });
        }
      }
      console.error('[ai/marketing-mission] Gemini error:', e);
      const msg: string = e?.message ?? String(e);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  } catch (error: any) {
    console.error('[/api/ai/marketing-mission]', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}


