/**
 * POST /api/customer-service/auto-reply
 *
 * Automated customer-service email processing. Called by GitHub Actions cron
 * every 15 minutes; uses per-business interval throttling so the actual work
 * only runs as often as the user configured (e.g. every 60 minutes).
 *
 * Auth: x-cron-secret header (cron path). Also accepts an authenticated session
 * for manual "Run Now" from the UI.
 *
 * Flow:
 *  1. Load auto-reply settings from Config sheet (enabled, interval, mode, etc.)
 *  2. Throttle check — skip if not enough time since last run.
 *  3. Run triage + draft generation (same logic as answer-queries).
 *  4. For each customer email:
 *     - mode='draft'  → create a Gmail DRAFT in the business mailbox
 *     - mode='send'   → send the reply immediately
 *  5. If forwardEmails configured → send notification emails to each address
 *     containing the AI draft + original thread for human review.
 *  6. Update CSAutoReplyLastRunAt + log.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleGenAI } from '@google/genai';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { BrandProfileRepository } from '@/lib/db/BrandProfileRepository';
import { BusinessInfoRepository } from '@/lib/db/BusinessInfoRepository';
import { ProductsRepository } from '@/lib/db/ProductsRepository';
import { SalesRepository } from '@/lib/db/SalesRepository';
import { decrypt } from '@/lib/encryption';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const ENV_CLIENT_ID     = process.env.GOOGLE_GMAIL_CLIENT_ID     || process.env.GOOGLE_ADS_CLIENT_ID     || '';
const ENV_CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || '';

// Config keys stored in the business Google Sheet Config tab
const C = {
  ENABLED:      'CSAutoReplyEnabled',
  INTERVAL:     'CSAutoReplyIntervalMins',
  MODE:         'CSAutoReplyMode',         // 'draft' | 'send'
  FORWARD:      'CSAutoReplyForwardEmails', // comma-separated
  DAYS:         'CSAutoReplyDays',
  SOURCES:      'CSAutoReplyDataSources',  // JSON array of source ids
  LAST_RUN:     'CSAutoReplyLastRunAt',
  GUIDELINES:   'CSGuidelines',
};

// ── helpers ───────────────────────────────────────────────────────────────────

function requireSession() {
  const s = cookies().get('marketoir_session');
  if (!s?.value) return null;
  try { return JSON.parse(s.value); } catch { return null; }
}

async function getAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Token error: ${data.error} ${data.error_description ?? ''}`);
  return data.access_token;
}

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(input: string): string {
  const n = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(n + '='.repeat((4 - n.length % 4) % 4), 'base64').toString('utf8');
}

function extractHeader(headers: any[] | undefined, name: string): string {
  const h = headers?.find((x: any) => String(x?.name || '').toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

function extractPlainText(payload: any): string {
  if (!payload) return '';
  if (payload.body?.data && payload.mimeType?.toLowerCase() === 'text/plain') {
    try { return decodeBase64Url(payload.body.data); } catch { return ''; }
  }
  const parts: any[] = Array.isArray(payload.parts) ? payload.parts : [];
  for (const p of parts) { const t = extractPlainText(p); if (t.trim()) return t; }
  if (payload.body?.data) { try { return decodeBase64Url(payload.body.data); } catch { return ''; } }
  return '';
}

function cleanText(t: string): string {
  return t.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').replace(/\s{2,}/g, ' ').trim();
}

function safeJsonParse<T>(raw: string): T | null {
  const c = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(c) as T; } catch { return null; }
}

async function readConfig(sheets: GoogleSheetsService, databaseId: string): Promise<Record<string, string>> {
  try {
    const rows = (await sheets.getData(databaseId, 'Config!A:B')) as string[][];
    const out: Record<string, string> = {};
    for (const r of rows ?? []) if (r[0]) out[r[0]] = r[1] ?? '';
    return out;
  } catch { return {}; }
}

async function writeConfig(sheets: GoogleSheetsService, databaseId: string, key: string, value: string): Promise<void> {
  try {
    const rows = (await sheets.getData(databaseId, 'Config!A:B')) as string[][];
    const idx = rows?.findIndex(r => r[0] === key) ?? -1;
    if (idx >= 1) {
      await sheets.updateData(databaseId, `Config!A${idx + 1}:B${idx + 1}`, [[key, value]]);
    } else {
      const next = (rows?.length ?? 0) + 1;
      await sheets.updateData(databaseId, `Config!A${next}:B${next}`, [[key, value]]);
    }
  } catch { /* non-fatal */ }
}

// Lightweight gather functions (reused from answer-queries)
async function gatherBizContext(databaseId: string): Promise<string> {
  const parts: string[] = [];
  try {
    const bi = await BusinessInfoRepository.get(databaseId);
    if (bi) parts.push(`Brand: ${bi.brand_name || ''}\nWebsite: ${bi.brand_url || ''}`);
  } catch {}
  try {
    const bp = await BrandProfileRepository.get(databaseId);
    if (bp) {
      const lines = ['=== BRAND PROFILE ==='];
      if (bp.mission)          lines.push(`Mission: ${bp.mission}`);
      if (bp.tone)             lines.push(`Tone: ${bp.tone}`);
      if (bp.shipping_policy)  lines.push(`Shipping Policy: ${bp.shipping_policy}`);
      if (bp.returns_policy)   lines.push(`Returns Policy: ${bp.returns_policy}`);
      if (bp.praises)          lines.push(`What Customers Praise: ${bp.praises}`);
      if (bp.objections)       lines.push(`Common Objections: ${bp.objections}`);
      if (bp.physical_branches) lines.push(`Branches: ${bp.physical_branches}`);
      parts.push(lines.join('\n'));
    }
  } catch {}
  return parts.filter(Boolean).join('\n\n');
}

async function gatherDataContext(databaseId: string, inventorySystemId: string, sourceIds: string[]): Promise<string> {
  const parts: string[] = [];
  if (sourceIds.includes('products')) {
    try {
      const products = await ProductsRepository.list(inventorySystemId);
      const header = 'code,name,brand,retail_price,soh,available,sold_90d\n';
      const rows = products.slice(0, 100).map(p => `${p.code ?? ''},${p.name ?? ''},${p.brand ?? ''},${p.retail_price ?? ''},${p.global_soh ?? 0},${p.global_available ?? 0},${p.sales_qty_90d ?? 0}`).join('\n');
      if (rows) parts.push(`=== PRODUCTS (soh, price) ===\n${header}${rows}`);
    } catch {}
  }
  if (sourceIds.includes('sales')) {
    try {
      const sales = await SalesRepository.query(inventorySystemId, { limit: 80 });
      const header = 'date,product,branch,customer,qty,total\n';
      const rows = sales.map(s => `${s.order_date ?? ''},${s.product_name ?? ''},${s.branch_name ?? ''},${s.customer_name ?? ''},${s.qty},${s.line_total}`).join('\n');
      if (rows) parts.push(`=== RECENT SALES ===\n${header}${rows}`);
    } catch {}
  }
  return parts.filter(Boolean).join('\n\n');
}

// ── Gmail helpers ─────────────────────────────────────────────────────────────

/** Create a Gmail DRAFT (not sent) — human can find in Drafts folder and review. */
async function createGmailDraft(accessToken: string, draft: { to: string; subject: string; body: string; threadId: string; replyToMessageId?: string; references?: string }): Promise<{ success: boolean; draftId?: string; error?: string }> {
  const headers = [
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
  ];
  if (draft.replyToMessageId) headers.push(`In-Reply-To: ${draft.replyToMessageId}`);
  if (draft.references) headers.push(`References: ${draft.references}`);
  const mime = `${headers.join('\r\n')}\r\n\r\n${draft.body}\r\n`;

  const res = await fetch(`${GMAIL_API}/drafts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw: toBase64Url(mime), threadId: draft.threadId } }),
  });
  const data = await res.json();
  if (!res.ok || data.error) return { success: false, error: data?.error?.message || 'Draft creation failed' };
  return { success: true, draftId: data.id };
}

/** Send a reply immediately. */
async function sendGmailReply(accessToken: string, draft: { to: string; subject: string; body: string; threadId: string; replyToMessageId?: string; references?: string }): Promise<{ success: boolean; error?: string }> {
  const headers = [
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
  ];
  if (draft.replyToMessageId) headers.push(`In-Reply-To: ${draft.replyToMessageId}`);
  if (draft.references) headers.push(`References: ${draft.references}`);
  const mime = `${headers.join('\r\n')}\r\n\r\n${draft.body}\r\n`;

  const res = await fetch(`${GMAIL_API}/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: toBase64Url(mime), threadId: draft.threadId }),
  });
  const data = await res.json();
  if (!res.ok || data.error) return { success: false, error: data?.error?.message || 'Send failed' };
  return { success: true };
}

/** Send a forwarding notification to each address in the forward list. */
async function sendForwardNotification(accessToken: string, opts: {
  forwardTo: string;
  customerFrom: string;
  originalSubject: string;
  aiDraft: string;
  originalConversation: string;
  mode: 'draft' | 'send';
}): Promise<void> {
  const statusLine = opts.mode === 'draft'
    ? `A DRAFT reply has been prepared in your Gmail Drafts folder. Review it there before sending.`
    : `The reply below has been SENT automatically to the customer.`;

  const body = [
    `📬 Customer Service Auto-Reply — ${opts.originalSubject}`,
    ``,
    `From customer: ${opts.customerFrom}`,
    ``,
    statusLine,
    ``,
    `If you want to change or personalise the reply, find it in Gmail → Drafts.`,
    ``,
    `─────────────────────────────────────`,
    `AI DRAFT REPLY:`,
    `─────────────────────────────────────`,
    opts.aiDraft,
    ``,
    `─────────────────────────────────────`,
    `ORIGINAL EMAIL THREAD:`,
    `─────────────────────────────────────`,
    opts.originalConversation,
  ].join('\n');

  const subject = `[CS Auto-Reply] ${opts.originalSubject}`;
  const mime = [
    `To: ${opts.forwardTo}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    body,
  ].join('\r\n');

  await fetch(`${GMAIL_API}/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: toBase64Url(mime) }),
  }).catch(() => {}); // non-fatal
}

// ── Main handler ──────────────────────────────────────────────────────────────

async function runAutoReply(databaseId: string, force = false): Promise<{ processed: number; drafted: number; sent: number; forwarded: number; skipped: string }> {
  const sheets = new GoogleSheetsService();
  const config = await readConfig(sheets, databaseId);

  if (config[C.ENABLED] !== 'true' && !force) return { processed: 0, drafted: 0, sent: 0, forwarded: 0, skipped: 'Auto-reply disabled' };

  // Throttle check
  const intervalMins = Math.max(15, parseInt(config[C.INTERVAL] || '60', 10));
  const lastRun = config[C.LAST_RUN] ? new Date(config[C.LAST_RUN]).getTime() : 0;
  const msSinceLast = Date.now() - lastRun;
  if (!force && msSinceLast < intervalMins * 60 * 1000) {
    const remaining = Math.ceil((intervalMins * 60 * 1000 - msSinceLast) / 60000);
    return { processed: 0, drafted: 0, sent: 0, forwarded: 0, skipped: `Next run in ~${remaining} min` };
  }

  // Persist last-run immediately so parallel cron calls don't double-process.
  await writeConfig(sheets, databaseId, C.LAST_RUN, new Date().toISOString());

  const mode = (config[C.MODE] || 'draft') as 'draft' | 'send';
  const forwardEmails = (config[C.FORWARD] || '').split(',').map(e => e.trim()).filter(Boolean);
  const days = Math.max(1, Math.min(30, parseInt(config[C.DAYS] || '3', 10)));
  let sourceIds: string[] = ['businessInfo', 'brandProfile', 'products'];
  try { const p = JSON.parse(config[C.SOURCES] || '[]'); if (Array.isArray(p)) sourceIds = p; } catch {}
  const guidelines = config[C.GUIDELINES] || '';

  // Load Gmail credentials
  const conn = await ConnectionsRepository.get(databaseId).catch(() => null);
  if (!conn?.gmail_refresh_token) throw new Error('Gmail not connected');
  let refreshToken = conn.gmail_refresh_token;
  try { refreshToken = decrypt(refreshToken); } catch {}
  let clientId = ENV_CLIENT_ID;
  let clientSecret = ENV_CLIENT_SECRET;
  const anyConn = conn as any;
  if (anyConn.gmail_client_id) clientId = anyConn.gmail_client_id;
  if (anyConn.gmail_client_secret) { try { clientSecret = decrypt(anyConn.gmail_client_secret); } catch { clientSecret = anyConn.gmail_client_secret; } }
  if (!clientId || !clientSecret) throw new Error('Gmail OAuth credentials not configured');

  const accessToken = await getAccessToken(refreshToken, clientId, clientSecret);

  // Fetch inbox
  const meRes = await fetch(`${GMAIL_API}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const meData = await meRes.json();
  if (!meRes.ok) throw new Error(`Gmail profile error: ${meData?.error?.message || meRes.status}`);
  const meEmail = String(meData.emailAddress || '').toLowerCase();

  const listRes = await fetch(`${GMAIL_API}/messages?maxResults=500&q=${encodeURIComponent(`in:inbox category:primary newer_than:${days}d`)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const listData = await listRes.json();
  const messageList: { id: string; threadId: string }[] = listData.messages || [];
  if (!messageList.length) return { processed: 0, drafted: 0, sent: 0, forwarded: 0, skipped: 'Inbox empty' };

  const uniqueThreadIds = Array.from(new Set(messageList.map(m => m.threadId))).slice(0, 80);
  const threads = await Promise.all(uniqueThreadIds.map(async tid => {
    try { const r = await fetch(`${GMAIL_API}/threads/${tid}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` } }); return r.ok ? await r.json() : null; } catch { return null; }
  }));

  const candidates: any[] = [];
  for (const thread of threads) {
    if (!thread?.messages?.length) continue;
    const msgs = [...thread.messages].sort((a: any, b: any) => Number(a.internalDate || 0) - Number(b.internalDate || 0));
    const latest = msgs[msgs.length - 1];
    const latestFrom = (extractHeader(latest?.payload?.headers, 'From') || '').toLowerCase();
    if (!latestFrom || latestFrom.includes(meEmail)) continue; // already answered

    const lastExternal = [...msgs].reverse().find((m: any) => !extractHeader(m?.payload?.headers, 'From').toLowerCase().includes(meEmail)) || latest;
    const h = lastExternal?.payload?.headers;
    const from = extractHeader(h, 'From');
    const subject = extractHeader(h, 'Subject') || '(No subject)';
    const replyToMessageId = extractHeader(h, 'Message-ID') || '';
    const references = extractHeader(h, 'References') || extractHeader(h, 'In-Reply-To') || '';
    const conversation = msgs.slice(-6).map((m: any) => {
      const mh = m?.payload?.headers;
      return `[From: ${extractHeader(mh, 'From')} | ${extractHeader(mh, 'Date')}]\n${cleanText(extractPlainText(m.payload) || m.snippet || '').slice(0, 1200)}`;
    }).join('\n\n---\n\n');
    if (!conversation.trim()) continue;
    candidates.push({ threadId: thread.id, messageId: lastExternal.id, replyToMessageId, references, from, subject, conversation, preview: cleanText(extractPlainText(lastExternal.payload) || lastExternal.snippet || '').slice(0, 200) });
  }
  if (!candidates.length) return { processed: 0, drafted: 0, sent: 0, forwarded: 0, skipped: 'No unanswered threads' };

  // Resolve Gemini model + inventory system
  const modelId = conn.gemini_model || 'gemini-2.5-flash-preview-04-17';
  const inventorySystemId = await resolveInventorySystemId(databaseId).catch(() => databaseId);
  const bizContext = await gatherBizContext(databaseId);
  const dataContext = await gatherDataContext(databaseId, inventorySystemId, sourceIds);
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  const ai = new GoogleGenAI({ apiKey });

  // Phase 1: Triage
  const triagePrompt = `Identify which emails below are genuine customer enquiries vs suppliers, outreach, or automated notifications.
Return JSON ONLY: { "triage": [{ "threadId": "...", "messageId": "...", "isCustomer": true|false }] }
Business context: ${bizContext}
Emails: ${JSON.stringify(candidates.map(c => ({ threadId: c.threadId, messageId: c.messageId, from: c.from, subject: c.subject, preview: c.preview })))}`;

  let customerKeys = new Set<string>();
  try {
    const tr = await ai.models.generateContent({ model: modelId, contents: triagePrompt });
    const tp = safeJsonParse<{ triage?: any[] }>(tr.text?.trim() || '');
    for (const t of tp?.triage ?? []) if (t?.isCustomer) customerKeys.add(`${t.threadId}::${t.messageId}`);
  } catch {
    for (const c of candidates) customerKeys.add(`${c.threadId}::${c.messageId}`);
  }

  const customerCandidates = candidates.filter(c => customerKeys.has(`${c.threadId}::${c.messageId}`));
  if (!customerCandidates.length) return { processed: candidates.length, drafted: 0, sent: 0, forwarded: 0, skipped: 'No customer emails after triage' };

  // Phase 2: Draft replies in batches of 6
  const fullContext = [bizContext, dataContext].filter(Boolean).join('\n\n');
  const BATCH = 6;
  const allDrafts: any[] = [];
  for (let i = 0; i < customerCandidates.length; i += BATCH) {
    const batch = customerCandidates.slice(i, i + BATCH);
    const prompt = `You are a customer service assistant. Write a draft reply for each email.
Tone: warm, direct, no exclamation marks, no hyperbole.
${guidelines ? `Guidelines: ${guidelines}\n` : ''}
Return JSON ONLY: { "items": [{ "threadId": "...", "messageId": "...", "draftResponse": "..." }] }
=== CONTEXT ===
${fullContext}
=== EMAILS ===
${JSON.stringify(batch)}`;
    try {
      const ar = await ai.models.generateContent({ model: modelId, contents: prompt });
      const ap = safeJsonParse<{ items?: any[] }>(ar.text?.trim() || '');
      for (const it of ap?.items ?? []) {
        const orig = batch.find(c => c.threadId === it.threadId && c.messageId === it.messageId);
        if (orig && it.draftResponse) allDrafts.push({ ...orig, draftResponse: String(it.draftResponse) });
      }
    } catch { /* skip batch */ }
  }

  // Phase 3: Create drafts / send + forward
  let drafted = 0, sent = 0, forwarded = 0;
  for (const d of allDrafts) {
    const subjectBase = d.subject || '(No subject)';
    const subject = /^re:/i.test(subjectBase) ? subjectBase : `Re: ${subjectBase}`;
    const draftPayload = { to: d.from, subject, body: d.draftResponse, threadId: d.threadId, replyToMessageId: d.replyToMessageId, references: d.references };

    let actionOk = false;
    if (mode === 'draft') {
      const r = await createGmailDraft(accessToken, draftPayload);
      if (r.success) { drafted++; actionOk = true; }
    } else {
      const r = await sendGmailReply(accessToken, draftPayload);
      if (r.success) { sent++; actionOk = true; }
    }

    if (actionOk && forwardEmails.length) {
      for (const fwd of forwardEmails) {
        await sendForwardNotification(accessToken, { forwardTo: fwd, customerFrom: d.from, originalSubject: d.subject, aiDraft: d.draftResponse, originalConversation: d.conversation, mode });
        forwarded++;
      }
    }
  }

  return { processed: candidates.length, drafted, sent, forwarded, skipped: '' };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const cronSecret = req.headers.get('x-cron-secret');

  if (cronSecret) {
    // Cron path — process all IMS-enabled businesses
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const databaseId: string = body.databaseId || '';
    if (!databaseId) return NextResponse.json({ error: 'databaseId required' }, { status: 400 });
    try {
      const result = await runAutoReply(databaseId, false);
      return NextResponse.json({ success: true, ...result });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
  }

  // Session path — manual "Run Now" from the UI
  const session = requireSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const force = body.force === true;
  try {
    const result = await runAutoReply(session.businessId as string, force);
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
