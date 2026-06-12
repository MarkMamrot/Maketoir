import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';

/**
 * POST /api/website/judge-urls
 *
 * Uses Gemini to (in one AI call):
 *  1. Evaluate and rank candidate URLs (keep best product-page matches)
 *  2. Generate product content using the Tavily research already available
 *
 * Body: {
 *   product:     { name, brand, code?, barcode?, styleCode?, retailPrice? }
 *   urlData:     { url: string; answer: string }[]
 *   databaseId?: string   — when provided, brand profile + templates are loaded
 *   notes?:      string   — any user notes to include
 * }
 * Returns: {
 *   rankedUrls:        { url, keep, reason }[]
 *   generatedContent?: { title, cin7Description, websiteDescription, tags, cin7Online, cin7Channels }
 * }
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getBrandProfile(databaseId: string): Promise<string> {
  const sheets = new GoogleSheetsService();
  try {
    const data = await sheets.getData(databaseId, 'BrandProfile!A:U') as string[][];
    if (!data || data.length < 2) return '';
    const row = data[1];
    const fields: [number, string][] = [
      [1, 'Brand Mission'], [2, 'Unique Value Proposition'], [3, 'Brand Tone & Voice'],
      [4, 'Target Demographics'], [5, 'Hero Products'], [7, 'Price Positioning'],
    ];
    return fields.filter(([i]) => row[i]?.trim()).map(([i, l]) => `${l}: ${row[i].trim()}`).join('\n');
  } catch { return ''; }
}

async function getProductTemplates(databaseId: string): Promise<{ description: any; title: any; tags: any }> {
  const sheets = new GoogleSheetsService();
  const empty = { description: null, title: null, tags: null };
  try {
    const config = await sheets.getData(databaseId, 'Config!A:B') as string[][];
    const websiteSheetId = config?.find(r => r[0] === 'WebsiteSheetId')?.[1];
    if (!websiteSheetId) return empty;
    const rows = await sheets.getData(websiteSheetId, 'ProductDescTemplate') as string[][];
    if (!rows || rows.length < 2) return empty;
    const headerRow = rows[0];
    if (headerRow[0]?.trim() === 'Timestamp') {
      const jsonStr = rows[1]?.[1]?.trim();
      if (jsonStr) { try { return { ...empty, description: JSON.parse(jsonStr) }; } catch {} }
      return empty;
    }
    const result: any = { description: null, title: null, tags: null };
    for (const row of rows.slice(1)) {
      const key = row[0]?.trim();
      const val = row[1]?.trim();
      if (key && ['description', 'title', 'tags'].includes(key) && val) {
        try { result[key] = JSON.parse(val); } catch { result[key] = val; }
      }
    }
    return result;
  } catch { return empty; }
}

function buildHtmlRules(tmpl: any): string {
  const rules: string[] = [];
  const headingTag: string | undefined = tmpl?.headingTag;
  const headingColour: string | undefined = tmpl?.headingColour;
  const bulletChar: string | undefined = tmpl?.bulletChar;
  const bulletColour: string | undefined = tmpl?.bulletColour;
  if (headingTag || headingColour) {
    const tag = headingTag ?? 'h3';
    const style = headingColour ? ` style="color:${headingColour};"` : '';
    rules.push(`- Section headings: always use <${tag}${style}>Heading Text</${tag}>`);
  }
  if (bulletColour || bulletChar) {
    const char = bulletChar ?? '✓';
    if (bulletColour) {
      rules.push(`- Bullet lists: <ul style="list-style:none;padding:0;margin:0 0 14px 0;"><li style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;"><span style="color:${bulletColour};font-weight:bold;flex-shrink:0;">${char}</span><span>Item text here</span></li></ul>`);
      rules.push(`- No CSS classes. Inline styles only.`);
    } else {
      rules.push(`- Every list item MUST start with "${char}" — e.g. <li>${char} Feature text here</li>`);
    }
  }
  return rules.length > 0 ? `\nHTML RULES (mandatory):\n${rules.join('\n')}` : '';
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });
    }

    const { product, urls, databaseId } = await req.json();
    if (!product?.name || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'product.name and urls[] are required.' }, { status: 400 });
    }

    const validUrls: string[] = urls.filter((u: any) => typeof u === 'string' && u.trim());

    // Load brand context in parallel when databaseId is provided
    let brandProfile = '';
    let templates: { description: any; title: any; tags: any } = { description: null, title: null, tags: null };
    if (databaseId) {
      [brandProfile, templates] = await Promise.all([
        getBrandProfile(databaseId),
        getProductTemplates(databaseId),
      ]);
    }

    const titleInstruction = templates.title
      ? `Follow this title template exactly:\n${JSON.stringify(templates.title, null, 2)}`
      : 'Create a clear, descriptive title including brand name, product type, and key features.';

    const htmlRules = buildHtmlRules(templates.description);
    const descInstruction = templates.description
      ? `Follow this description template exactly:${htmlRules}\n${JSON.stringify(templates.description, null, 2)}`
      : `Write a compelling HTML product description with key features and benefits.${htmlRules}`;

    const tagsInstruction = templates.tags
      ? `Follow this tags template:\n${JSON.stringify(templates.tags, null, 2)}`
      : 'Generate relevant SEO tags as a comma-separated list.';

    const brandBlock = brandProfile ? `\nBRAND CONTEXT:\n${brandProfile}` : '';
    const priceBlock = product.retailPrice ? `\n- Retail Price: $${product.retailPrice}` : '';
    const skuBlock = product.code ? `\n- SKU: ${product.code}` : '';
    const urlList = validUrls.map((u, i) => `${i + 1}. ${u}`).join('\n');

    const prompt = `You are an expert e-commerce product content writer and URL evaluator. Use Google Search to research the product and candidate pages, then perform both tasks below.

PRODUCT TO FIND:
- Name: ${product.name}
- Brand: ${product.brand}${skuBlock}${product.barcode ? `\n- Barcode: ${product.barcode}` : ''}${priceBlock}

CANDIDATE URLs (search for and visit each one):
${urlList}

═══════════════════════════════════════════════════════
TASK 1 — URL EVALUATION
═══════════════════════════════════════════════════════

Visit each candidate URL using Google Search. For each URL decide: is it the actual product listing page for THIS EXACT product by ${product.brand}?

Rules:
- keep = true  → confirmed product listing page for THIS specific product (any retailer is fine)
- keep = false → category page, search results page, brand homepage, wrong product, or unrelated page
- KEEP ONLY THE SINGLE BEST URL (the most authoritative/detailed product page). All others keep = false.
- If none are a product page, keep the most relevant one as keep = true.
- Do NOT invent URLs not in the list above.

═══════════════════════════════════════════════════════
TASK 2 — CONTENT GENERATION
═══════════════════════════════════════════════════════

Using the product information you find via Google Search on those pages, generate content for our e-commerce store.
${brandBlock}

STRICT CONTENT RULES — use ONLY product-specific information:
✅ Include: product features, materials, construction, fit, sizing, colours, technology, specifications, intended use
❌ Exclude: shipping costs, delivery times, return policies, store promotions, brand/store contact info, pricing from the third-party site, any other store-specific information

TITLE:
${titleInstruction}

WEBSITE DESCRIPTION (HTML):
${descInstruction}

TAGS:
${tagsInstruction}

CIN7 DESCRIPTION:
Write a short plain-text internal stock description focusing on product type and key features only. Strictly under 220 characters. No HTML.

═══════════════════════════════════════════════════════
RETURN FORMAT
═══════════════════════════════════════════════════════

Return ONLY valid JSON — no markdown fences, no extra text:
{
  "rankedUrls": [
    { "url": "<exact url from the list above>", "keep": true, "reason": "<1 sentence>" }
  ],
  "title": "...",
  "cin7Description": "...",
  "websiteDescription": "...",
  "tags": "..."
}`;

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: 'You are an expert e-commerce content writer and URL evaluator. Always respond with valid JSON only — no markdown code blocks, no preamble.' }] },
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
    };

    // Use gemini-2.5-flash for better grounded search quality
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Gemini error: ${res.status}`, detail: errText.slice(0, 300) }, { status: 502 });
    }

    const json = await res.json();
    // Gemini with google_search may return multiple parts (search tool calls + final text).
    // Always use the LAST text part, which is the model's final response.
    const parts: any[] = json.candidates?.[0]?.content?.parts ?? [];
    const text = ([...parts].reverse().find((p: any) => typeof p.text === 'string')?.text ?? '').trim();

    // Strip markdown fences if present, then try to parse
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
      if (!parsed) {
        return NextResponse.json({ error: 'AI returned unparseable JSON', raw: text.slice(0, 500) }, { status: 500 });
      }
    }

    const rankedUrls = (parsed.rankedUrls ?? []).filter((r: any) => r?.url?.trim());

    // Build generatedContent when the AI returned content fields
    let generatedContent: Record<string, any> | undefined;
    if (parsed.title || parsed.cin7Description || parsed.websiteDescription) {
      generatedContent = {
        title:              String(parsed.title ?? '').trim(),
        cin7Description:    String(parsed.cin7Description ?? '').trim().slice(0, 220),
        websiteDescription: String(parsed.websiteDescription ?? '').trim(),
        tags:               String(parsed.tags ?? '').trim(),
        images:             Array(10).fill(''),
        cin7Online:         '-4',
        cin7Channels:       'Shopify https://monsterthreads.myshopify.com/',
      };
    }

    return NextResponse.json({ success: true, rankedUrls, generatedContent });
  } catch (e: any) {
    console.error('[judge-urls]', e);
    return NextResponse.json({ error: e.message ?? 'Internal server error' }, { status: 500 });
  }
}
