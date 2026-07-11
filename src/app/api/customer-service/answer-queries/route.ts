import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleGenAI } from '@google/genai';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { GoogleAdsService } from '@/services/GoogleAdsService';
import { GoogleAnalyticsService } from '@/services/GoogleAnalyticsService';
import { MetaAdsService } from '@/services/MetaAdsService';
import { decrypt } from '@/lib/encryption';
import { getGlobalSpecsSheetId } from '@/lib/globalApiSpecs';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { BusinessInfoRepository } from '@/lib/db/BusinessInfoRepository';
import { BrandProfileRepository } from '@/lib/db/BrandProfileRepository';
import { ProductsRepository } from '@/lib/db/ProductsRepository';
import { SalesRepository } from '@/lib/db/SalesRepository';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Fallback env vars (used when a business hasn't saved per-business credentials).
const ENV_CLIENT_ID     = process.env.GOOGLE_GMAIL_CLIENT_ID     || process.env.GOOGLE_ADS_CLIENT_ID     || '';
const ENV_CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || '';

const MAX_THREADS = 150;
const MAX_MESSAGE_CHARS = 1500;

type CandidateThread = {
  threadId: string;
  messageId: string;
  replyToMessageId: string;
  references: string;
  from: string;
  subject: string;
  receivedAt: string;
  preview: string;   // first ~200 chars of latest customer message — used for triage only
  conversation: string;
};

function requireSession() {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return null;
  try { return JSON.parse(session.value); } catch { return null; }
}

async function getAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Token error: ${data.error} ${data.error_description ?? ''}`);
  return data.access_token;
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function extractHeader(headers: any[] | undefined, name: string): string {
  if (!headers) return '';
  const h = headers.find((x: any) => String(x?.name || '').toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

function extractEmail(fromHeader: string): string {
  const m = fromHeader.match(/<([^>]+)>/);
  return (m?.[1] || fromHeader || '').trim().toLowerCase();
}

function extractPlainText(payload: any): string {
  if (!payload) return '';

  if (payload.body?.data && payload.mimeType?.toLowerCase() === 'text/plain') {
    try { return decodeBase64Url(payload.body.data); } catch { return ''; }
  }

  const parts: any[] = Array.isArray(payload.parts) ? payload.parts : [];
  for (const part of parts) {
    const text = extractPlainText(part);
    if (text.trim()) return text;
  }

  if (payload.body?.data) {
    try { return decodeBase64Url(payload.body.data); } catch { return ''; }
  }
  return '';
}

function cleanText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isLikelyCustomerService(candidate: CandidateThread): boolean {
  const from = (candidate.from || '').toLowerCase();
  if (!from) return false;

  // Hard excludes for common automated/non-customer senders.
  if (/no-?reply|mailer-daemon|postmaster/.test(from)) return false;

  const subject = (candidate.subject || '').toLowerCase();
  const convo = (candidate.conversation || '').toLowerCase();
  const hay = `${subject}\n${convo}`;

  const include = [
    'order', 'refund', 'return', 'exchange', 'cancel', 'shipping', 'delivery',
    'damaged', 'wrong item', 'not received', 'help', 'support', 'issue', 'problem',
    'branch', 'store', 'opening hour', 'pickup',
  ];
  const exclude = [
    'seo', 'guest post', 'backlink', 'partnership proposal', 'media kit',
    'sponsored', 'newsletter', 'unsubscribe', 'cold outreach',
  ];

  if (exclude.some(x => hay.includes(x))) return false;
  if (include.some(x => hay.includes(x))) return true;

  // Default to true for unanswered human-looking inbound emails.
  return true;
}

async function gatherBusinessInfo(databaseId: string): Promise<string> {
  try {
    const row = await BusinessInfoRepository.get(databaseId);
    if (!row) return '';
    return [
      '=== BUSINESS INFORMATION ===',
      `Brand Name: ${row.brand_name || 'N/A'}`,
      `Website: ${row.brand_url || 'N/A'}`,
      `Years in Business: ${row.years_in_business || 'N/A'}`,
      `Facebook: ${row.facebook_link || 'N/A'}`,
      `Instagram: ${row.instagram_link || 'N/A'}`,
      `Pinterest: ${row.pinterest_link || 'N/A'}`,
    ].join('\n');
  } catch {
    return '';
  }
}

async function gatherBrandProfile(databaseId: string): Promise<string> {
  try {
    const row = await BrandProfileRepository.get(databaseId);
    if (!row) return '';
    const lines: string[] = ['=== BRAND PROFILE ==='];
    if (row.mission)                lines.push(`Mission: ${row.mission}`);
    if (row.uvp)                    lines.push(`Unique Value Proposition: ${row.uvp}`);
    if (row.tone)                   lines.push(`Tone / Voice: ${row.tone}`);
    if (row.demographics)           lines.push(`Target Demographics: ${row.demographics}`);
    if (row.geo)                    lines.push(`Geography: ${row.geo}`);
    if (row.hero_products)          lines.push(`Hero Products: ${row.hero_products}`);
    if (row.price_positioning)      lines.push(`Price Positioning: ${row.price_positioning}`);
    if (row.shipping_policy)        lines.push(`Shipping Policy: ${row.shipping_policy}`);
    if (row.returns_policy)         lines.push(`Returns Policy: ${row.returns_policy}`);
    if (row.loyalty_program)        lines.push(`Loyalty Program: ${row.loyalty_program}`);
    if (row.praises)                lines.push(`What Customers Praise: ${row.praises}`);
    if (row.objections)             lines.push(`Common Objections: ${row.objections}`);
    if (row.competitors)            lines.push(`Competitors: ${row.competitors}`);
    if (row.market_gap)             lines.push(`Market Gap / Differentiation: ${row.market_gap}`);
    if (row.brand_history)          lines.push(`Brand History: ${row.brand_history}`);
    if (row.operations_summary)     lines.push(`Operations Summary: ${row.operations_summary}`);
    if (row.physical_branches)      lines.push(`Physical Branches: ${row.physical_branches}`);
    if (row.detailed_brand_aesthetic) lines.push(`Brand Aesthetic: ${row.detailed_brand_aesthetic}`);
    if (row.connected_software)     lines.push(`Connected Software: ${row.connected_software}`);
    if (row.brand_colours)          lines.push(`Brand Colours: ${row.brand_colours}`);
    return lines.join('\n');
  } catch {
    return '';
  }
}

function rowsToCompactCsv(rows: string[][], maxRows = 100): string {
  if (!rows || rows.length <= 1) return '';
  const trimmed = [rows[0], ...rows.slice(1, Math.min(rows.length, maxRows + 1))];
  return trimmed
    .map(r => r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

async function gatherCompactDataContext(
  sheets: GoogleSheetsService,
  databaseId: string,
  inventorySystemId: string,
  websiteSheetId: string,
  dataSources: string[],
  metaToken: string,
  metaAccountId: string,
  ga4PropertyId: string,
): Promise<string> {
  const parts: string[] = [];

  if (dataSources.includes('businessInfo')) parts.push(await gatherBusinessInfo(databaseId));
  if (dataSources.includes('brandProfile')) parts.push(await gatherBrandProfile(databaseId));

  if (dataSources.includes('products')) {
    try {
      const products = await ProductsRepository.list(inventorySystemId);
      const rows: string[][] = [
        ['option_id', 'code', 'name', 'brand', 'cost', 'retail_price', 'soh', 'available', 'incoming', 'sold_90d', 'sold_12m'],
        ...products.slice(0, 120).map(p => [
          p.option_id, p.code ?? '', p.name ?? '', p.brand ?? '',
          String(p.cost ?? ''), String(p.retail_price ?? ''),
          String(p.global_soh ?? 0), String(p.global_available ?? 0), String(p.global_incoming ?? 0),
          String(p.sales_qty_90d ?? 0), String(p.sales_qty_12m ?? 0),
        ]),
      ];
      const csv = rowsToCompactCsv(rows, 120);
      if (csv) parts.push(`=== PRODUCTS — code, name, price, stock on hand, sold last 90d / 12m (first 120) ===\n${csv}`);
    } catch { /* ignore */ }
  }

  if (dataSources.includes('sales')) {
    try {
      const sales = await SalesRepository.query(inventorySystemId, { limit: 120 });
      const rows: string[][] = [
        ['order_id', 'order_date', 'product_option_id', 'product_name', 'branch_name', 'customer_name', 'qty', 'unit_price', 'line_total'],
        ...sales.map(s => [
          s.order_id, s.order_date ?? '', s.product_option_id, s.product_name ?? '',
          s.branch_name ?? '', s.customer_name ?? '',
          String(s.qty), String(s.unit_price), String(s.line_total),
        ]),
      ];
      const csv = rowsToCompactCsv(rows, 120);
      if (csv) parts.push(`=== SALES (first 120 rows) ===\n${csv}`);
    } catch { /* ignore */ }
  }

  if (dataSources.includes('website')) {
    try {
      const rows = (await sheets.getData(websiteSheetId || databaseId, 'Shopify_Products')) as string[][];
      const csv = rowsToCompactCsv(rows, 120);
      if (csv) parts.push(`=== WEBSITE PRODUCTS (first 120 rows) ===\n${csv}`);
    } catch { /* ignore */ }
  }

  if (dataSources.includes('websiteCollections')) {
    try {
      const rows = (await sheets.getData(websiteSheetId || databaseId, 'Shopify_Collections')) as string[][];
      const csv = rowsToCompactCsv(rows, 200);
      if (csv) parts.push(`=== WEBSITE COLLECTIONS (name + URL) ===\n${csv}`);
    } catch { /* ignore */ }
  }

  if (dataSources.includes('googleAds')) {
    try {
      const ads = new GoogleAdsService();
      if (ads.customerId) {
        const today = new Date();
        const monthAgo = new Date(); monthAgo.setDate(today.getDate() - 30);
        const fmt = (d: Date) => d.toISOString().split('T')[0];
        const metrics = await ads.getLivePerformanceMetrics(fmt(monthAgo), fmt(today)) as any[];
        if (metrics?.length) {
          const top = metrics.slice(0, 12).map(m => `${m.campaign?.name || 'Campaign'}: spend=${((m.metrics?.cost_micros || 0) / 1_000_000).toFixed(2)}, conv=${m.metrics?.conversions || 0}`);
          parts.push(`=== GOOGLE ADS (last 30 days, top campaigns) ===\n${top.join('\n')}`);
        }
      }
    } catch { /* ignore */ }
  }

  if (dataSources.includes('metaAds')) {
    try {
      if (metaToken && metaAccountId) {
        const accountId = metaAccountId.startsWith('act_') ? metaAccountId : `act_${metaAccountId}`;
        const meta = new MetaAdsService(metaToken, accountId);
        const rows = await meta.getLivePerformanceMetrics('last_30d') as any[];
        if (rows?.length) {
          const top = rows.slice(0, 10).map((r: any) => `${r.campaign_name || r.adset_name || 'Campaign'}: spend=${r.spend || 0}, purchases=${r.purchase || r.conversions || 0}`);
          parts.push(`=== META ADS (last 30 days) ===\n${top.join('\n')}`);
        }
      }
    } catch { /* ignore */ }
  }

  if (dataSources.includes('analytics')) {
    try {
      if (ga4PropertyId) {
        const ga = new GoogleAnalyticsService(ga4PropertyId);
        const perf = await ga.getRecentPerformance();
        if (perf?.length) {
          const top = perf.slice(0, 14).map((d: any) => `${d.date}: sessions=${d.sessions}, conversions=${d.conversions}, revenue=${d.revenue}`);
          parts.push(`=== GA4 RECENT PERFORMANCE ===\n${top.join('\n')}`);
        }
      }
    } catch { /* ignore */ }
  }

  if (dataSources.includes('cin7Api') || dataSources.includes('googleAdsApi') || dataSources.includes('metaApi')) {
    try {
      const globalSpecsId = await getGlobalSpecsSheetId(sheets);
      const rows = await sheets.getData(globalSpecsId, 'APIInstructions!A:E') as string[][];
      const apiSpecMap: Record<string, string> = {
        cin7Api: 'cin7',
        googleAdsApi: 'google-ads',
        metaApi: 'meta',
      };
      for (const src of ['cin7Api', 'googleAdsApi', 'metaApi']) {
        if (!dataSources.includes(src)) continue;
        const key = apiSpecMap[src];
        const hit = rows?.slice(1).find(r => r[0] === key);
        const specText = (hit?.[4] || '').slice(0, 4000);
        if (specText) parts.push(`=== ${src} SPEC (abridged) ===\n${specText}`);
      }
    } catch { /* ignore */ }
  }

  return parts.filter(Boolean).join('\n\n');
}

function safeJsonParse<T>(raw: string): T | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned) as T; } catch { return null; }
}

export async function POST(req: Request) {
  const user = requireSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });

  const body = await req.json();
  const databaseId: string = body.databaseId || '';
  const days: number = Math.max(1, Math.min(90, Number(body.days || 7)));
  const dataSources: string[] = Array.isArray(body.dataSources) ? body.dataSources : [];
  const guidelines: string = typeof body.guidelines === 'string' ? body.guidelines.trim() : '';

  if (!databaseId) return NextResponse.json({ error: 'databaseId is required.' }, { status: 400 });

  const sheets = new GoogleSheetsService();
  let refreshToken = '';
  let gmailClientId     = ENV_CLIENT_ID;
  let gmailClientSecret = ENV_CLIENT_SECRET;
  let modelId = 'gemini-2.5-flash-preview-04-17';
  let inventorySystemId = databaseId;
  let ga4PropertyId = '';
  let metaToken = '';
  let metaAccountId = '';
  let websiteSheetId = '';

  try {
    const [conn, invSysId] = await Promise.all([
      ConnectionsRepository.get(databaseId),
      resolveInventorySystemId(databaseId).catch(() => databaseId),
    ]);

    if (!conn) {
      return NextResponse.json({ error: 'Could not load business connection settings.' }, { status: 500 });
    }

    inventorySystemId = invSysId;
    websiteSheetId = conn.website_sheet_id ?? '';

    if (conn.gmail_refresh_token) {
      try { refreshToken = decrypt(conn.gmail_refresh_token); } catch { refreshToken = conn.gmail_refresh_token; }
    }
    // Per-business OAuth credentials (override env fallbacks if present)
    if ((conn as any).gmail_client_id) gmailClientId = (conn as any).gmail_client_id;
    if ((conn as any).gmail_client_secret) {
      try { gmailClientSecret = decrypt((conn as any).gmail_client_secret); }
      catch { gmailClientSecret = (conn as any).gmail_client_secret; }
    }
    if (conn.gemini_model) modelId = conn.gemini_model;
    ga4PropertyId = conn.ga4_property_id ?? '';
    metaAccountId = conn.meta_ad_account_id ?? '';
    if (conn.meta_access_token) {
      try { metaToken = decrypt(conn.meta_access_token); } catch { metaToken = conn.meta_access_token; }
    }
  } catch {
    return NextResponse.json({ error: 'Could not load business connection settings.' }, { status: 500 });
  }

  if (!refreshToken) {
    return NextResponse.json({ error: 'Gmail refresh token is not configured in Connections.' }, { status: 400 });
  }
  if (!gmailClientId || !gmailClientSecret) {
    return NextResponse.json({ error: 'Gmail OAuth credentials (Client ID / Client Secret) are not configured. Save them in Settings → Connections → Gmail.' }, { status: 400 });
  }

  const accessToken = await getAccessToken(refreshToken, gmailClientId, gmailClientSecret);

  const profileRes = await fetch(`${GMAIL_API}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = await profileRes.json();
  if (!profileRes.ok || profile.error) {
    return NextResponse.json({ error: profile?.error?.message || 'Failed to read Gmail profile.' }, { status: 500 });
  }

  const meEmail = String(profile.emailAddress || '').toLowerCase();

  // Search only the Primary inbox tab (excludes Updates, Promotions, Social etc.)
  const inboxQuery = `in:inbox category:primary newer_than:${days}d`;
  const listRes = await fetch(`${GMAIL_API}/messages?maxResults=500&q=${encodeURIComponent(inboxQuery)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listData = await listRes.json();
  if (!listRes.ok || listData.error) {
    return NextResponse.json({ error: `Gmail API error: ${listData?.error?.message || listRes.status}` }, { status: 500 });
  }
  const messageList: { id: string; threadId: string }[] = listData.messages || [];
  if (messageList.length === 0) {
    return NextResponse.json({ items: [], debug: { messageCount: 0, threadCount: 0, candidateCount: 0, note: 'Gmail returned 0 messages in inbox for this date range.' } });
  }

  const uniqueThreadIds = Array.from(new Set(messageList.map(m => m.threadId))).slice(0, MAX_THREADS);
  const threads = await Promise.all(
    uniqueThreadIds.map(async threadId => {
      try {
        const r = await fetch(`${GMAIL_API}/threads/${threadId}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    }),
  );

  const candidates: CandidateThread[] = [];

  for (const thread of threads) {
    if (!thread?.messages?.length) continue;

    const messages = [...thread.messages].sort((a: any, b: any) => Number(a.internalDate || 0) - Number(b.internalDate || 0));
    const latest = messages[messages.length - 1];
    const latestFrom = extractEmail(extractHeader(latest?.payload?.headers, 'From'));
    if (!latestFrom || latestFrom === meEmail) continue; // already answered by us

    const lastExternal = [...messages].reverse().find((m: any) => extractEmail(extractHeader(m?.payload?.headers, 'From')) !== meEmail) || latest;
    const lastExternalHeaders = lastExternal?.payload?.headers;

    const from = extractHeader(lastExternalHeaders, 'From') || latestFrom;
    const subject = extractHeader(lastExternalHeaders, 'Subject') || '(No subject)';
    const date = extractHeader(lastExternalHeaders, 'Date') || '';
    const replyToMessageId = extractHeader(lastExternalHeaders, 'Message-ID') || '';
    const references = extractHeader(lastExternalHeaders, 'References') || extractHeader(lastExternalHeaders, 'In-Reply-To') || '';

    const latestCustomerBody = cleanText(extractPlainText(lastExternal.payload) || lastExternal.snippet || '');
    // First 2 sentences for triage (approx 200 chars, stop at sentence boundary)
    const sentenceMatch = latestCustomerBody.match(/^.{0,300}?(?:[.!?](?:\s|$)){2}/);
    const preview = (sentenceMatch ? sentenceMatch[0] : latestCustomerBody.slice(0, 220)).trim();

    const conversation = messages.slice(-6).map((m: any) => {
      const hdr = m?.payload?.headers;
      const fromVal = extractHeader(hdr, 'From');
      const when = extractHeader(hdr, 'Date');
      const msgSubject = extractHeader(hdr, 'Subject') || subject;
      const bodyText = cleanText(extractPlainText(m.payload) || m.snippet || '').slice(0, MAX_MESSAGE_CHARS);
      return `[From: ${fromVal} | Date: ${when}]\nSubject: ${msgSubject}\n${bodyText}`;
    }).join('\n\n---\n\n');

    if (!conversation.trim()) continue;

    candidates.push({
      threadId: thread.id,
      messageId: lastExternal.id,
      replyToMessageId,
      references,
      from,
      subject,
      receivedAt: date,
      preview,
      conversation,
    });
  }

  if (candidates.length === 0) {
    return NextResponse.json({ items: [], debug: { messageCount: messageList.length, threadCount: uniqueThreadIds.length, candidateCount: 0, note: 'All inbox threads already have a reply from you, or had no readable body text.' } });
  }

  // Load minimal business context for triage (just brand profile + business info)
  const [businessInfo, brandProfile] = await Promise.all([
    gatherBusinessInfo(databaseId),
    gatherBrandProfile(databaseId),
  ]);
  const bizContext = [businessInfo, brandProfile].filter(Boolean).join('\n\n');

  const ai = new GoogleGenAI({ apiKey });
  const candidateById = new Map(candidates.map(c => [`${c.threadId}::${c.messageId}`, c]));

  // ── Phase 1: Triage ─────────────────────────────────────────────────────────
  // Send ALL unanswered threads as tiny snippets (sender + subject + first 2 sentences).
  // AI decides which are genuine customer queries vs suppliers, personal contacts, cold outreach etc.
  const triageItems = candidates.map(c => ({
    threadId: c.threadId,
    messageId: c.messageId,
    from: c.from,
    subject: c.subject,
    preview: c.preview,
  }));

  const triagePrompt = `You are helping a retail/ecommerce business identify which inbound emails are genuine customer enquiries.

For each email below, decide whether it is LIKELY from a customer asking us a question or needing help (true), or from a supplier, cold outreach, personal contact, automated notification, newsletter, or unrelated party (false).

Base your decision on:
- The sender name and domain (customer email addresses are usually personal/gmail/hotmail/consumer domains; suppliers and outreach senders are often from company domains with unfamiliar names)
- The subject line
- The first 2 sentences of the message
- What you know about our business (see context below)

Return JSON ONLY — no markdown fences:
{
  "triage": [
    { "threadId": "...", "messageId": "...", "isCustomer": true, "reason": "one-line reason" }
  ]
}

=== BUSINESS CONTEXT ===
${bizContext || 'No business context available.'}

=== EMAILS TO TRIAGE ===
${JSON.stringify(triageItems, null, 2)}
`;

  let customerThreadKeys = new Set<string>();
  try {
    const triageResp = await ai.models.generateContent({ model: modelId, contents: triagePrompt });
    const triageRaw = triageResp.text?.trim() || '';
    const triageParsed = safeJsonParse<{ triage?: any[] }>(triageRaw);
    if (triageParsed?.triage && Array.isArray(triageParsed.triage)) {
      for (const t of triageParsed.triage) {
        if (t?.isCustomer === true) customerThreadKeys.add(`${t.threadId}::${t.messageId}`);
      }
    }
  } catch {
    // If triage AI call fails entirely, fall back to heuristic filter
    for (const c of candidates.filter(isLikelyCustomerService)) {
      customerThreadKeys.add(`${c.threadId}::${c.messageId}`);
    }
  }

  const customerCandidates = candidates.filter(c => customerThreadKeys.has(`${c.threadId}::${c.messageId}`));

  if (customerCandidates.length === 0) {
    return NextResponse.json({ items: [], triageItems, debug: { messageCount: messageList.length, threadCount: uniqueThreadIds.length, candidateCount: candidates.length, triagePassedCount: 0, note: 'Triage found no genuine customer enquiries in the date range.' } });
  }

  // ── Phase 2: Draft replies ───────────────────────────────────────────────────
  // Now load full data context and generate drafts only for triaged customer emails.
  const dataContext = await gatherCompactDataContext(
    sheets,
    databaseId,
    inventorySystemId,
    websiteSheetId,
    dataSources,
    metaToken,
    metaAccountId,
    ga4PropertyId,
  );

  const BATCH_SIZE = 8;
  const allItems: any[] = [];

  for (let i = 0; i < customerCandidates.length; i += BATCH_SIZE) {
    const batch = customerCandidates.slice(i, i + BATCH_SIZE);
    const draftPrompt = `You are a customer service assistant for a retail/ecommerce brand.

Write a draft reply for each customer email thread below.

Tone and style:
- Write like a normal, helpful person — not a marketer. Plain, warm, conversational.
- No exclamation marks unless the customer used them first. No hyperbolic adjectives (wonderful, amazing, fantastic, quirky, delightful etc.).
- Get to the point quickly. One short greeting, answer the question, sign off. That's it.
- Do not invent order IDs, stock levels, or promises not present in the context.
- If key details are missing, ask one short clarifying question — don't pad around it.
${guidelines ? `\n=== BUSINESS GUIDELINES FOR REPLIES ===\n${guidelines}\n` : ''}

Return JSON ONLY (no markdown fences):
{
  "items": [
    {
      "threadId": "...",
      "messageId": "...",
      "summary": "one-line description of the customer's query",
      "customerMessage": "1-2 sentence summary of what the customer wants",
      "draftResponse": "full reply body text"
    }
  ]
}

=== BUSINESS CONTEXT ===
${dataContext || 'No extra business context selected.'}

=== CUSTOMER EMAIL THREADS ===
${JSON.stringify(batch, null, 2)}
`;

    try {
      const aiResp = await ai.models.generateContent({ model: modelId, contents: draftPrompt });
      const raw = aiResp.text?.trim() || '';
      const parsed = safeJsonParse<{ items?: any[] }>(raw);
      if (parsed?.items && Array.isArray(parsed.items)) {
        for (const it of parsed.items) {
          const key = `${it.threadId}::${it.messageId}`;
          const original = candidateById.get(key);
          if (!original || !it.draftResponse) continue;
          allItems.push({
            threadId: original.threadId,
            messageId: original.messageId,
            replyToMessageId: original.replyToMessageId,
            references: original.references,
            from: original.from,
            subject: original.subject,
            receivedAt: original.receivedAt,
            summary: String(it.summary || '').trim(),
            customerMessage: String(it.customerMessage || '').trim(),
            draftResponse: String(it.draftResponse || '').trim(),
          });
        }
      }
    } catch {
      // skip failed batch, continue with others
    }
  }

  return NextResponse.json({ items: allItems, triageItems, model: modelId, debug: { messageCount: messageList.length, threadCount: uniqueThreadIds.length, candidateCount: candidates.length, triagePassedCount: customerCandidates.length } });
}
