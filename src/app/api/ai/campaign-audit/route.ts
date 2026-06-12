/**
 * POST /api/ai/campaign-audit
 *
 * Streams Server-Sent Events (SSE) with audit phases:
 *   { phase: 'loading_data',  message: string }
 *   { phase: 'analyzing',     message: string }
 *   { phase: 'complete',      audit: CampaignAuditReport }
 *   { phase: 'error',         error: string }
 *
 * Body: { databaseId: string }
 */
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { GoogleGenAI } from '@google/genai';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { BrandProfileRepository } from '@/lib/db/BrandProfileRepository';
import { BusinessInfoRepository } from '@/lib/db/BusinessInfoRepository';
import { CalcReportsRepository } from '@/lib/db/CalcReportsRepository';
import { ConfigRepository } from '@/lib/db/ConfigRepository';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';

// ── System prompt ─────────────────────────────────────────────────────────────
const AUDIT_SYSTEM_PROMPT = `You are a senior digital marketing architect and campaign strategist specialising in retail and e-commerce brands.

Your task is to conduct a comprehensive Campaign Architecture Audit & Gap Analysis for the business whose data is provided.

You have access to:
- Active Google Ads campaigns (names, channel types, bidding strategies, performance metrics)
- Meta Ads campaigns (names, objectives, spend, ROAS, reach)
- GA4 analytics (channel breakdown, revenue attribution by source/medium)
- Klaviyo email campaigns and automation flows
- Top-selling product brands, categories, and revenue data (from the inventory system)
- Online store performance metrics (conversion rate, sessions, revenue)

Your audit must identify:
1. STRUCTURAL GAPS — campaign types that should exist but don't (e.g., no remarketing, no Shopping campaigns for an e-commerce brand, no brand awareness layer, no Performance Max)
2. COVERAGE GAPS — top-selling product categories or brands not being actively advertised
3. UNDERPERFORMERS — campaigns with poor ROAS, high spend relative to conversions, or low CTR vs industry benchmarks
4. CHANNEL IMBALANCES — over-reliance on one platform; unhealthy marketing ecosystem
5. EMAIL AUTOMATION GAPS — missing critical Klaviyo flows (abandoned cart, welcome series, win-back, post-purchase, browse abandonment, VIP loyalty)
6. QUICK WINS — high-impact changes implementable in under 1 week
7. PRIORITISED RECOMMENDATIONS — ordered action plan

Important audit rules:
- Reference actual campaign names and numbers from the data where possible
- If a channel has no data, flag it as "not_configured" with score 0 and a recommendation to connect it
- ROAS benchmarks for e-commerce: < 2.0x = critical; 2.0–3.5x = at_risk; > 3.5x = healthy (note: brand awareness/upper-funnel campaigns are exempt from ROAS thresholds)
- For Google Ads, check for: Shopping/PMax campaigns (essential for e-commerce), Search with brand terms, Remarketing/RLSA audiences, Performance Max
- For Meta Ads, check for: Prospecting vs Retargeting split, Dynamic Product Ads/Catalog campaigns, Video awareness layer
- For email, the six critical flows are: Welcome Series, Abandoned Cart, Browse Abandonment, Post-Purchase, Win-Back, VIP/Loyalty
- Overall health score: weighted average of channel scores; penalise heavily for missing critical flows and zero ad coverage for top brands
- Be direct and specific — say "Pause the [campaign name] campaign — it has $X spend with 0 conversions" not vague generalities

Return ONLY a valid JSON object (no markdown fences, no explanation text outside the JSON):
{
  "executiveSummary": "2–3 paragraph strategic overview of the current marketing architecture and its most critical gaps",
  "overallHealthScore": 0,
  "generatedAt": "ISO datetime string",
  "channelScores": {
    "googleAds": { "score": 0, "status": "healthy|at_risk|critical|not_configured", "headline": "one-line assessment" },
    "metaAds":   { "score": 0, "status": "healthy|at_risk|critical|not_configured", "headline": "one-line assessment" },
    "ga4":       { "score": 0, "status": "healthy|at_risk|critical|not_configured", "headline": "one-line assessment" },
    "klaviyo":   { "score": 0, "status": "healthy|at_risk|critical|not_configured", "headline": "one-line assessment" }
  },
  "coverageGaps": [
    { "category": "string", "topProducts": ["string"], "estimatedRevenueLost": "e.g. $2,000–$5,000/month", "priority": "high|medium|low", "suggestedAction": "string" }
  ],
  "underperformers": [
    { "channel": "string", "campaignName": "string", "issue": "string", "metric": "string", "recommendation": "string", "urgency": "high|medium|low" }
  ],
  "missingCampaignTypes": [
    { "type": "string", "channel": "string", "rationale": "string", "estimatedImpact": "string", "effort": "high|medium|low" }
  ],
  "emailAutomationGaps": [
    { "flowType": "string", "industryBenchmark": "string", "potentialRevenue": "string", "priority": "high|medium|low" }
  ],
  "quickWins": [
    { "title": "string", "description": "string", "channel": "string", "effort": "low|medium", "impact": "high|medium", "timeToImplement": "string" }
  ],
  "recommendations": [
    { "id": 1, "title": "string", "description": "string", "channel": "string", "effort": "high|medium|low", "impact": "high|medium|low", "priority": 1 }
  ]
}`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function nc(v: unknown): string {
  return String(v ?? '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function sheetToCsvText(rows: string[][]): string {
  if (!rows?.length) return '';
  return rows
    .map(r => (r as string[]).map(cell => `"${(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

// ── Data assembler ────────────────────────────────────────────────────────────
async function buildAuditContext(sheets: GoogleSheetsService, databaseId: string): Promise<string> {
  const conn = await ConnectionsRepository.get(databaseId).catch(() => null);
  const inventorySystemId = await resolveInventorySystemId(databaseId).catch(() => databaseId);
  const marketingDataId = await ConfigRepository.get(databaseId, 'MarketingDataSheetId').catch(() => null);

  const [brandProfileRow, businessInfoRow] = await Promise.all([
    BrandProfileRepository.get(databaseId).catch(() => null),
    BusinessInfoRepository.get(databaseId).catch(() => null),
  ]);

  const sections: string[] = [];

  // Brand profile
  if (brandProfileRow) {
    const fields: [string, string | null][] = [
      ['Brand Name',         (brandProfileRow as any).brand_name ?? null],
      ['UVP',                brandProfileRow.uvp],
      ['Tone & Voice',       brandProfileRow.tone],
      ['Target Demographics', brandProfileRow.demographics],
      ['Top Geographies',    brandProfileRow.geo],
      ['Hero Products',      brandProfileRow.hero_products],
      ['Price Positioning & AOV', brandProfileRow.price_positioning],
      ['Customer Praises',   brandProfileRow.praises],
      ['Objections',         brandProfileRow.objections],
      ['Competitors',        brandProfileRow.competitors],
      ['Market Gap',         brandProfileRow.market_gap],
      ['Business Operations', brandProfileRow.operations_summary],
      ['Physical Branches',  brandProfileRow.physical_branches],
    ];
    const lines = ['=== BRAND PROFILE ==='];
    for (const [label, val] of fields) {
      if (val?.trim()) lines.push(`${label}: ${nc(val)}`);
    }
    sections.push(lines.join('\n'));
  }

  // Business info
  if (businessInfoRow) {
    sections.push([
      '=== BUSINESS INFORMATION ===',
      `Brand Name: ${nc(businessInfoRow.brand_name)}`,
      `Website: ${nc(businessInfoRow.brand_url)}`,
      `Years in Business: ${nc(businessInfoRow.years_in_business)}`,
    ].join('\n'));
  }

  if (!marketingDataId) {
    sections.push('=== MARKETING DATA ===\nMarketing Data spreadsheet has not been synced yet. All channels will be assessed as not_configured.');
  } else {
    // Read marketing tabs in parallel (fail gracefully for missing tabs)
    const tabNames = [
      'GAds_Campaigns', 'GAds_Shopping', 'GAds_Keywords',
      'Meta_Campaigns', 'Meta_AdSets',
      'GA4_Channels',
      'Klaviyo_Campaigns', 'Klaviyo_Flows', 'Klaviyo_Lists',
    ];
    const tabResults = await Promise.all(
      tabNames.map(t => sheets.getData(marketingDataId, t).catch(() => null) as Promise<string[][] | null>)
    );
    const tabs: Record<string, string[][] | null> = {};
    tabNames.forEach((t, i) => { tabs[t] = tabResults[i]; });

    const appendTab = (key: string, label: string, maxRows = 200) => {
      const rows = tabs[key];
      if (!rows || rows.length <= 1) {
        sections.push(`=== ${label.toUpperCase()} ===\nNo data synced.`);
        return;
      }
      const limited = rows.slice(0, maxRows + 1);
      sections.push(`=== ${label.toUpperCase()} (${rows.length - 1} rows) ===\n${sheetToCsvText(limited)}`);
    };

    appendTab('GAds_Campaigns', 'Google Ads — Campaigns', 100);
    appendTab('GAds_Shopping',  'Google Ads — Shopping Products', 150);
    appendTab('GAds_Keywords',  'Google Ads — Keywords', 100);
    appendTab('Meta_Campaigns', 'Meta Ads — Campaigns', 100);
    appendTab('Meta_AdSets',    'Meta Ads — Ad Sets', 100);
    appendTab('GA4_Channels',   'GA4 — Channel Breakdown', 100);
    appendTab('Klaviyo_Campaigns', 'Klaviyo — Email Campaigns', 100);
    appendTab('Klaviyo_Flows',     'Klaviyo — Automation Flows', 100);
    appendTab('Klaviyo_Lists',     'Klaviyo — Subscriber Lists', 50);
  }

  // Inventory / brand data
  const [brandReport, onlineBrandReport, onlinePerfReport, salesByMonthReport] = await Promise.all([
    CalcReportsRepository.getReport(inventorySystemId, 'brand-summary').catch(() => null),
    CalcReportsRepository.getReport(inventorySystemId, 'online-top-brands').catch(() => null),
    CalcReportsRepository.getReport(inventorySystemId, 'online-performance').catch(() => null),
    CalcReportsRepository.getReport(inventorySystemId, 'sales-by-month').catch(() => null),
  ]);

  if (brandReport && Array.isArray(brandReport) && brandReport.length > 0) {
    const lines = ['=== TOP BRANDS BY TOTAL SALES (all channels, GST exc.) ===',
      'Brand | SKUs | Total Qty | Total Cost | Avg Margin | Sales 90d | Sales 180d | Sales 365d'];
    for (const r of brandReport) {
      const m = (v: any) => `$${parseFloat(v||'0').toLocaleString('en-AU',{minimumFractionDigits:2})}`;
      lines.push(`${nc(r.brand)} | ${r.skus} | ${r.qty} | ${m(r.totalCost)} | ${parseFloat(r.avgMargin||'0').toFixed(1)}% | ${m(r.sales90d)} | ${m(r.sales180d)} | ${m(r.sales365d)}`);
    }
    sections.push(lines.join('\n'));
  }

  if (onlineBrandReport && Array.isArray(onlineBrandReport) && onlineBrandReport.length > 0) {
    const lines = ['=== ONLINE TOP BRANDS (Shopify / online channel only) ===',
      'Brand | Revenue | Qty Sold | Orders'];
    for (const r of onlineBrandReport) {
      lines.push(`${nc(r.brand)} | $${parseFloat(r.revenue||'0').toLocaleString('en-AU',{minimumFractionDigits:2})} | ${r.qty} | ${r.orders}`);
    }
    sections.push(lines.join('\n'));
  }

  if (onlinePerfReport && typeof onlinePerfReport === 'object' && !Array.isArray(onlinePerfReport)) {
    const pr = onlinePerfReport as any;
    sections.push([
      '=== ONLINE STORE PERFORMANCE ===',
      `Conversion Rate: ${pr.conversionRate != null ? parseFloat(pr.conversionRate).toFixed(2) + '%' : 'N/A'}`,
      `Sessions: ${parseInt(pr.sessions||'0',10).toLocaleString()}`,
      `Purchases: ${parseFloat(pr.purchases||'0')}`,
    ].join('\n'));
  }

  if (salesByMonthReport && Array.isArray(salesByMonthReport) && salesByMonthReport.length > 0) {
    const lines = ['=== MONTHLY REVENUE TREND (all channels) ===', 'Month | Revenue'];
    for (const r of salesByMonthReport) {
      lines.push(`${nc(r.month)} | $${parseFloat(r.revenue||'0').toLocaleString('en-AU',{minimumFractionDigits:2})}`);
    }
    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n---\n\n');
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const encoder = new TextEncoder();
  const emit = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

  let controllerRef: ReadableStreamDefaultController | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      controllerRef = controller;
      try {
        const body = await req.json().catch(() => ({}));
        const { databaseId } = body as { databaseId?: string };

        if (!databaseId) {
          controller.enqueue(emit({ phase: 'error', error: 'Missing databaseId' }));
          controller.close();
          return;
        }

        const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
        if (!apiKey) {
          controller.enqueue(emit({ phase: 'error', error: 'GEMINI_API_KEY not configured.' }));
          controller.close();
          return;
        }

        // ── Phase 1: Load data ─────────────────────────────────────────────
        controller.enqueue(emit({ phase: 'loading_data', message: 'Reading campaign and inventory data…' }));

        const sheets = new GoogleSheetsService();
        let modelId = 'gemini-2.5-flash-preview-04-17';

        // Resolve model from Connections
        try {
          const conn = await ConnectionsRepository.get(databaseId).catch(() => null);
          if (conn?.gemini_model) modelId = conn.gemini_model;
        } catch { /* use default */ }

        const context = await buildAuditContext(sheets, databaseId);

        // ── Phase 2: Run AI analysis ───────────────────────────────────────
        controller.enqueue(emit({ phase: 'analyzing', message: 'Running AI campaign audit — this may take 30–60 seconds…' }));

        const ai = new GoogleGenAI({ apiKey });
        const prompt = `Please audit the following marketing data and return your analysis as a JSON object exactly matching the schema in your instructions.\n\n${context}`;

        const response = await ai.models.generateContent({
          model: modelId,
          contents: prompt,
          systemInstruction: AUDIT_SYSTEM_PROMPT,
          generationConfig: { responseMimeType: 'application/json' },
        } as any);

        const rawText: string = (response as any)?.candidates?.[0]?.content?.parts?.[0]?.text
          ?? (typeof (response as any)?.text === 'string' ? (response as any).text : '');

        let audit: Record<string, unknown>;
        try {
          // Strip possible markdown fences
          const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
          audit = JSON.parse(cleaned);
        } catch {
          controller.enqueue(emit({ phase: 'error', error: 'AI returned non-JSON response. Try again.' }));
          controller.close();
          return;
        }

        audit.generatedAt = new Date().toISOString();

        controller.enqueue(emit({ phase: 'complete', audit }));
      } catch (e: any) {
        console.error('[campaign-audit]', e);
        if (controllerRef) {
          controllerRef.enqueue(emit({ phase: 'error', error: e?.message ?? 'Unknown error' }));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
