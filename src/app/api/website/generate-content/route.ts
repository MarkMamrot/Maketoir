import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';

const SYSTEM_INSTRUCTION = `You are an expert e-commerce product content writer specialising in retail apparel and accessories. You use web search to research specific products and write accurate, engaging, SEO-optimised content for Shopify stores. Always respond with valid JSON only — no markdown code blocks, no preamble.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getBrandProfile(sheets: GoogleSheetsService, databaseId: string): Promise<string> {
  try {
    const data = await sheets.getData(databaseId, 'BrandProfile!A:U') as string[][];
    if (!data || data.length < 2) return '';
    const row = data[1];
    const fields: [number, string][] = [
      [1, 'Brand Mission'], [2, 'Unique Value Proposition'], [3, 'Brand Tone & Voice'],
      [4, 'Target Demographics'], [5, 'Top Geographies'], [6, 'Hero Products'],
      [7, 'Price Positioning'], [16, 'Business Operations'], [18, 'Brand History'],
    ];
    return fields.filter(([i]) => row[i]?.trim()).map(([i, l]) => `${l}: ${row[i].trim()}`).join('\n');
  } catch { return ''; }
}

async function getBusinessInfo(sheets: GoogleSheetsService, databaseId: string): Promise<string> {
  try {
    const data = await sheets.getData(databaseId, 'BusinessInfo!A:G') as string[][];
    if (!data || data.length < 2) return '';
    const row = data[1];
    return [
      `Brand Name: ${row[1] || 'N/A'}`,
      `Website: ${row[2] || 'N/A'}`,
    ].join('\n');
  } catch { return ''; }
}

async function getProductTemplates(sheets: GoogleSheetsService, databaseId: string): Promise<{
  description: any; title: any; tags: any;
}> {
  const empty = { description: null, title: null, tags: null };
  try {
    const config = await sheets.getData(databaseId, 'Config!A:B') as string[][];
    const websiteSheetId = config?.find(r => r[0] === 'WebsiteSheetId')?.[1];
    if (!websiteSheetId) return empty;
    const rows = await sheets.getData(websiteSheetId, 'ProductDescTemplate') as string[][];
    if (!rows || rows.length < 2) return empty;
    const headerRow = rows[0];
    // Old single-row format
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

function buildHtmlRules(
  tmpl: any,
): string {
  const rules: string[] = [];
  const headingTag: string | undefined = tmpl?.headingTag;
  const headingColour: string | undefined = tmpl?.headingColour;
  const bulletChar: string | undefined = tmpl?.bulletChar;
  const bulletColour: string | undefined = tmpl?.bulletColour;

  if (headingTag || headingColour) {
    const tag = headingTag ?? 'h3';
    const style = headingColour ? ` style="color:${headingColour};"` : '';
    rules.push(`- Section headings: always use <${tag}${style}>Heading Text</${tag}> — apply exactly on every heading, no deviations.`);
  }

  if (bulletColour || bulletChar) {
    const char = bulletChar ?? '✓';
    if (bulletColour) {
      const bulletRule =
        `<ul style="list-style:none;padding:0;margin:0 0 14px 0;">` +
        `<li style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;">` +
        `<span style="color:${bulletColour};font-weight:bold;flex-shrink:0;">${char}</span>` +
        `<span>Item text here</span></li></ul>`;
      rules.push(`- Bullet lists: use this exact pattern (never plain <ul><li>):\n  ${bulletRule}`);
    } else {
      rules.push(`- Every list item MUST start with "${char}" — e.g. <li>${char} Feature text here</li>`);
    }
    rules.push(`- No CSS classes. Inline styles only as shown above.`);
  }

  return rules.length > 0
    ? `\nHTML GENERATION RULES (mandatory — follow exactly, no deviations):\n${rules.join('\n')}`
    : '';
}

function buildFullPrompt(
  product: { name: string; brand: string; code: string; styleCode: string; retailPrice: string },
  brandProfile: string,
  businessInfo: string,
  templates: { description: any; title: any; tags: any },
  discoveredUrls: string[] = [],
  tavilyInfo: string = '',
): string {
  const titleBlock = templates.title
    ? `\nTITLE TEMPLATE:\n${JSON.stringify(templates.title, null, 2)}`
    : '\nTITLE TEMPLATE:\nCreate a clear, descriptive product title including brand name, product type, and key features.';

  const htmlRulesBlock = buildHtmlRules(templates.description);

  const descBlock = templates.description
    ? `\nDESCRIPTION TEMPLATE:\n${JSON.stringify(templates.description, null, 2)}${htmlRulesBlock}`
    : '\nDESCRIPTION TEMPLATE:\nWrite a compelling HTML product description with key features and benefits.';

  const tagsBlock = templates.tags
    ? `\nTAGS TEMPLATE:\n${JSON.stringify(templates.tags, null, 2)}`
    : '\nTAGS TEMPLATE:\nGenerate relevant SEO tags as a comma-separated list.';

  const researchBlock = tavilyInfo
    ? `\nPRODUCT RESEARCH (sourced via Tavily Search):\n${tavilyInfo}`
    : '';

  const urlBlock = discoveredUrls.length > 0
    ? `\nVERIFIED PRODUCT PAGE URLs:\n${discoveredUrls.map((u, i) => `${i + 1}. ${u}`).join('\n')}`
    : '';

  const taskInstruction = tavilyInfo
    ? `Using ONLY the product research and URLs provided above, generate all content fields for "${product.name}" by ${product.brand}. Do not search the web — all information needed is in the research block above.`
    : `Research "${product.name}" by ${product.brand} using the verified URLs above (or by web search if none provided), then generate all content fields.`;

  return `Generate complete website content for this specific product.

BUSINESS INFO:
${businessInfo}

BRAND CONTEXT:
${brandProfile || 'No brand profile configured.'}
${titleBlock}
${descBlock}
${tagsBlock}

PRODUCT:
- Product Name: ${product.name}
- Brand: ${product.brand}
- SKU/Code: ${product.code}
- Style Code: ${product.styleCode}
- Retail Price: $${product.retailPrice}
${researchBlock}${urlBlock}

TASK:
1. ${taskInstruction}
2. Generate all content fields strictly following the templates above.

Return ONLY the following JSON (no markdown, no explanation):
{
  "title": "product title per title template",
  "websiteDescription": "full HTML description per description template",
  "tags": "comma-separated tags per tags template",
  "cin7Description": "short plain-text internal description, strictly under 220 characters",
  "images": [],
  "cin7Online": "-4",
  "cin7Channels": "Shopify https://monsterthreads.myshopify.com/"
}

For images: Leave the images array empty. The system will scrape the product page URLs separately.`;
}

function buildReformulatePrompt(
  product: { name: string; brand: string; code: string },
  brandProfile: string,
  field: string,
  currentValue: string,
  userNote: string,
  templates: { description: any; title: any; tags: any },
): string {
  let templateBlock = '';
  if (field === 'title' && templates.title) {
    templateBlock = `\nTITLE TEMPLATE:\n${JSON.stringify(templates.title, null, 2)}`;
  } else if (field === 'websiteDescription' && templates.description) {
    const htmlRulesBlock = buildHtmlRules(templates.description);
    templateBlock = `\nDESCRIPTION TEMPLATE:\n${JSON.stringify(templates.description, null, 2)}${htmlRulesBlock}`;
  } else if (field === 'tags' && templates.tags) {
    templateBlock = `\nTAGS TEMPLATE:\n${JSON.stringify(templates.tags, null, 2)}`;
  } else if (field === 'cin7Description') {
    templateBlock = '\nREQUIREMENT: Plain text, strictly under 220 characters. No HTML.';
  } else if (field === 'images') {
    templateBlock = '\nREQUIREMENT: Please provide a list of up to 5 official product page URLs you found in order of preference. Return JSON with {"productUrls": ["https://..."]}. Do not guess image URLs; the system will scrape the pages you provide.';
  }

  const noteBlock = userNote?.trim() ? `\nUSER NOTE: ${userNote.trim()}` : '';

  return `Improve one specific content field for a product listing.

PRODUCT: ${product.name} by ${product.brand} (SKU: ${product.code})

BRAND CONTEXT:
${brandProfile || 'No brand profile.'}
${templateBlock}
FIELD TO IMPROVE: ${field}
CURRENT VALUE: ${currentValue}
${noteBlock}

Rewrite this field to be better. Follow all template rules.${field === 'images' ? ' Use Google Search to find better images.' : ''}

Return ONLY this JSON (no markdown):
{ "${field}": <new value> }`;
}

// ── Step 1: Discover real product page URLs via Google Search grounding ────────
// The @google/genai SDK strips groundingChunks from the response object.
// We call the REST API directly to get the raw JSON which includes them.
async function discoverProductUrls(
  apiKey: string,
  modelId: string,
  product: { name: string; brand: string },
): Promise<string[]> {
  try {
    // Use a stable model for URL discovery — gemini-2.5-flash returns groundingChunks in REST
    const discoveryModel = 'gemini-2.5-flash';
    const restUrl = `https://generativelanguage.googleapis.com/v1beta/models/${discoveryModel}:generateContent?key=${apiKey}`;

    const restRes = await fetch(restUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Find the official product page and top major retailer listings for "${product.name}" by ${product.brand}. I need accurate URLs to specific product pages (not category or search result pages). List up to 6 page URLs.` }] }],
        tools: [{ google_search: {} }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!restRes.ok) {
      console.warn(`[URL Discovery] REST call failed: ${restRes.status}`);
      return [];
    }

    const json = await restRes.json();
    const chunks: any[] = json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const groundedUrls = chunks.map((c: any) => c.web?.uri).filter(Boolean) as string[];

    if (groundedUrls.length > 0) {
      console.log(`[URL Discovery] ${groundedUrls.length} grounding URLs for "${product.name}":`, groundedUrls);
      return [...new Set(groundedUrls)].slice(0, 8);
    }

    console.log(`[URL Discovery] groundingChunks empty for "${product.name}" — no URLs to scrape from grounding`);
    return [];
  } catch (e: any) {
    console.warn('[URL Discovery] Search call failed:', e.message);
    return [];
  }
}

function parseJsonResponse(text: string): any {
  const stripped = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  // Try direct parse first
  try { return JSON.parse(stripped); } catch {}
  // Try extracting JSON object
  const match = stripped.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const body = await req.json();
    const {
      databaseId,
      product,
      mode = 'full',
      field,
      currentContent,
      userNote = '',
      tavilyInfo = '',
      tavilyUrls = [] as string[],
      userPhotos = [] as string[],
      userNotes = '',
    } = body;

    if (!databaseId || !product) {
      return NextResponse.json({ error: 'Missing databaseId or product' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });
    }

    const sheets = new GoogleSheetsService();

    // Load context in parallel
    const [brandProfile, businessInfo, templates] = await Promise.all([
      getBrandProfile(sheets, databaseId),
      getBusinessInfo(sheets, databaseId),
      getProductTemplates(sheets, databaseId),
    ]);

    // Determine model — use the same model configured in Connections if available
    let modelId = 'gemini-2.5-flash';
    try {
      const connRows = await sheets.getData(databaseId, 'Connections') as string[][];
      if (connRows?.length >= 2) {
        const hdrs = connRows[0] as string[];
        const vals = connRows[1] as string[];
        const m = vals[hdrs.indexOf('GeminiModel')];
        if (m?.trim()) modelId = m.trim();
      }
    } catch { /* use default */ }

    // Build prompt
    let prompt: string;
    let useSearch = false; // URL discovery is now handled separately above

    if (mode === 'reformulate' && field) {
      const currentValue = field === 'images'
        ? JSON.stringify((currentContent as any)?.images ?? [])
        : String((currentContent as any)?.[field] ?? '');
      prompt = buildReformulatePrompt(product, brandProfile, field, currentValue, userNote, templates);
      // Only use search for images reformulation
      useSearch = (field === 'images');
    } else {
      prompt = buildFullPrompt(product, brandProfile, businessInfo, templates, [], tavilyInfo);
    }

    // Append user-supplied brief/notes to the prompt
    if (userNotes?.trim()) {
      prompt += `\n\nADDITIONAL NOTES FROM USER:\n${userNotes.trim()}`;
    }

    // Build content parts — text first, then any user-supplied photos
    const contentParts: any[] = [{ text: prompt }];
    for (const photo of (userPhotos as string[])) {
      if (!photo?.startsWith('data:')) continue;
      const [header, data] = photo.split(',');
      const mimeType = header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg';
      contentParts.push({ inline_data: { mime_type: mimeType, data } });
    }

    const restBody: any = {
      contents: [{ role: 'user', parts: contentParts }],
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    };
    if (useSearch) {
      restBody.tools = [{ google_search: {} }];
    }

    const genRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restBody),
        signal: AbortSignal.timeout(120000),
      },
    );

    if (!genRes.ok) {
      const errBody = await genRes.text();
      return NextResponse.json(
        { error: `Gemini API error (HTTP ${genRes.status}): ${errBody.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const genJson = await genRes.json();
    const text = (genJson.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();

    if (!text) {
      return NextResponse.json({ error: 'AI returned empty response.' }, { status: 500 });
    }

    const parsed = parseJsonResponse(text);
    if (!parsed) {
      return NextResponse.json({ error: 'AI response could not be parsed as JSON.', raw: text.slice(0, 500) }, { status: 500 });
    }

    // Normalise content structure
    if (mode === 'reformulate' && field) {
      return NextResponse.json({ success: true, field, value: parsed[field], raw: parsed });
    }

    // Use any image URLs the AI provided; otherwise empty (user scrapes via the UI)
    const finalImages = (Array.isArray(parsed.images) ? parsed.images : [])
      .map(String).filter((s: string) => s.startsWith('http'));

    const content = {
      title:              String(parsed.title ?? ''),
      websiteDescription: String(parsed.websiteDescription ?? ''),
      tags:               String(parsed.tags ?? ''),
      cin7Description:    String(parsed.cin7Description ?? '').slice(0, 220),
      images:             finalImages.slice(0, 10),
      cin7Online:         String(parsed.cin7Online ?? '-4'),
      cin7Channels:       String(parsed.cin7Channels ?? ''),
    };

    // Pad images to 10 slots
    while (content.images.length < 10) content.images.push('');

    return NextResponse.json({ success: true, content });
  } catch (e: any) {
    console.error('[generate-content]', e);
    return NextResponse.json({ error: e.message ?? 'Internal server error' }, { status: 500 });
  }
}
