import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { readSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { parseAiJsonResponse } from '@/lib/website/aiJsonResponse';

/**
 * POST /api/website/judge-urls
 *
 * Uses Gemini to evaluate and rank candidate URLs, keeping only the best exact
 * product page. Content generation happens separately from extracted page facts.
 *
 * Body: {
 *   product:     { name, brand, code?, barcode?, styleCode?, retailPrice? }
 *   urls:        string[]
 *   databaseId?: string   — when provided, brand profile + templates are loaded
 *   notes?:      string   — any user notes to include
 * }
 * Returns: {
 *   rankedUrls:        { url, keep, reason }[]
 * }
 */

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

    const { product, urls } = await req.json();
    if (!product?.name || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'product.name and urls[] are required.' }, { status: 400 });
    }

    const validUrls: string[] = urls.filter((u: any) => typeof u === 'string' && u.trim());

    const skuBlock = product.code ? `\n- SKU: ${product.code}` : '';
    const urlList = validUrls.map((u, i) => `${i + 1}. ${u}`).join('\n');

    const prompt = `You are an exact-product URL evaluator. Use Google Search to inspect the candidate pages.

PRODUCT TO FIND:
- Name: ${product.name}
- Brand: ${product.brand}${skuBlock}${product.barcode ? `\n- Barcode: ${product.barcode}` : ''}

CANDIDATE URLs (search for and visit each one):
${urlList}

Visit each candidate URL using Google Search. For each URL decide: is it the actual product listing page for THIS EXACT product by ${product.brand}?

Rules:
- keep = true  → confirmed product listing page for THIS specific product (any retailer is fine)
- keep = false → category page, search results page, brand homepage, wrong product, or unrelated page
- KEEP ONLY THE SINGLE BEST URL (the most authoritative/detailed product page). All others keep = false.
- If none are confirmed product pages for this exact product, set keep = false for EVERY URL.
- Do NOT invent URLs not in the list above.

═══════════════════════════════════════════════════════
RETURN FORMAT
═══════════════════════════════════════════════════════

Return ONLY valid JSON — no markdown fences, no extra text:
{
  "rankedUrls": [
    { "url": "<exact url from the list above>", "keep": true, "reason": "<1 sentence>" }
  ]
}`;

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: 'You are an exact-product URL evaluator. Always respond with valid JSON only — no markdown code blocks, no preamble.' }] },
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
    };

    let parsed: any = null;
    let finishReason = '';
    let responseLength = 0;
    for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
      const requestBody = attempt === 0
        ? body
        : {
            ...body,
            tools: undefined,
            generationConfig: {
              ...body.generationConfig,
              temperature: 0,
              responseMimeType: 'application/json',
            },
          };
      let res: Response;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(30000),
          },
        );
      } catch (error) {
        finishReason = error instanceof Error ? error.name : 'FETCH_FAILED';
        if (attempt === 0) continue;
        break;
      }
      const rawResponse = await res.text();
      if (!res.ok) {
        finishReason = `HTTP_${res.status}`;
        responseLength = rawResponse.length;
        if (res.status >= 500 && attempt === 0) continue;
        return NextResponse.json({ error: `Gemini error: ${res.status}`, detail: rawResponse.slice(0, 300) }, { status: 502 });
      }

      let json: any;
      try {
        json = JSON.parse(rawResponse);
      } catch {
        finishReason = 'NON_JSON_HTTP_RESPONSE';
        responseLength = rawResponse.length;
        continue;
      }
      const candidate = json.candidates?.[0];
      const textParts = (candidate?.content?.parts ?? [])
        .map((part: any) => typeof part.text === 'string' ? part.text : '')
        .filter(Boolean);
      finishReason = String(candidate?.finishReason ?? 'UNKNOWN');
      responseLength = textParts.reduce((length: number, text: string) => length + text.length, 0);
      parsed = parseAiJsonResponse(textParts);
    }

    if (!parsed) {
      if (finishReason === 'STOP' && responseLength === 0) {
        return NextResponse.json({
          success: true,
          validUrlFound: false,
          rankedUrls: validUrls.map(url => ({
            url,
            keep: false,
            reason: 'The product page could not be verified.',
          })),
        });
      }
      const runtimeSession = readSession();
      await reportRuntimeIssue({
        businessId: runtimeSession?.businessId,
        source: 'website-content',
        operation: 'judge_urls_parse_response',
        severity: 'error',
        title: 'Website content AI returned invalid JSON',
        error: new Error(`Gemini response could not be parsed after retry (${finishReason}).`),
        context: { productName: String(product.name).slice(0, 200), candidateUrlCount: validUrls.length, finishReason, responseLength },
      });
      return NextResponse.json({ error: 'AI returned unparseable JSON after retry.' }, { status: 502 });
    }

    const rankedUrls = (Array.isArray(parsed.rankedUrls) ? parsed.rankedUrls : [])
      .filter((entry: any) => entry?.url?.trim() && validUrls.includes(String(entry.url).trim()))
      .map((entry: any) => ({
        url: String(entry.url).trim(),
        keep: entry.keep === true,
        reason: String(entry.reason ?? '').trim(),
      }));
    const validUrlFound = rankedUrls.some((entry: any) => entry.keep);

    return NextResponse.json({ success: true, validUrlFound, rankedUrls });
  } catch (e: any) {
    console.error('[judge-urls]', e);
    return NextResponse.json({ error: e.message ?? 'Internal server error' }, { status: 500 });
  }
}
