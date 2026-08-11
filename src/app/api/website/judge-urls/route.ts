import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { parseAiJsonResponse } from '@/lib/website/aiJsonResponse';
import { imsQuery } from '@/services/IMSMySQLService';
import { DEFAULT_URL_JUDGE_MODEL, WEBSITE_AI_SETTING_KEYS } from '@/lib/website/contentPreferences';

/**
 * POST /api/website/judge-urls
 *
 * Uses Gemini to classify compact Google result evidence, keeping only the best
 * exact product page. Page extraction and content generation happen separately.
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
    const session = await getImsSession();
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });
    }

    const { databaseId, product, urls, candidates = [] } = await req.json();
    if (!product?.name || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'product.name and urls[] are required.' }, { status: 400 });
    }
    if (databaseId && databaseId !== session.businessId) {
      return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
    }

    const modelRows = await imsQuery<{ value: string | null }>(
      'SELECT value FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1',
      [session.businessId, WEBSITE_AI_SETTING_KEYS.urlJudgeModel],
    );
    const modelId = modelRows[0]?.value?.trim() || DEFAULT_URL_JUDGE_MODEL;

    const validUrls: string[] = urls.filter((u: any) => typeof u === 'string' && u.trim());
    const evidenceByUrl = new Map<string, string>(
      (Array.isArray(candidates) ? candidates : [])
        .filter((candidate: any) => validUrls.includes(String(candidate?.url ?? '').trim()))
        .map((candidate: any) => [
          String(candidate.url).trim(),
          String(candidate.evidence ?? '').trim().slice(0, 1200),
        ]),
    );

    const skuBlock = product.code ? `\n- SKU: ${product.code}` : '';
    const urlList = validUrls.map((url, index) => {
      const evidence = evidenceByUrl.get(url);
      return `${index + 1}. URL: ${url}${evidence ? `\n   GOOGLE RESULT: ${evidence}` : ''}`;
    }).join('\n');

    const prompt = `You are an exact-product URL evaluator. Classify the supplied Google result evidence without web browsing.

PRODUCT TO FIND:
- Name: ${product.name}
- Brand: ${product.brand}${skuBlock}${product.barcode ? `\n- Barcode: ${product.barcode}` : ''}

CANDIDATE URLS AND GOOGLE RESULT EVIDENCE:
${urlList}

For each URL decide whether the URL and result evidence identify an actual listing page for THIS EXACT product by ${product.brand}.

Rules:
- keep = true  → confirmed product listing page for THIS specific product (any retailer is fine)
- keep = false → category page, search results page, brand homepage, wrong product, or unrelated page
- KEEP ONLY THE SINGLE BEST URL (the most authoritative/detailed product page). All others keep = false.
- If none are confirmed product pages for this exact product, set keep = false for EVERY URL.
- If evidence is absent or ambiguous, do not guess; set keep = false.
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
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' },
    };

    let parsed: any = null;
    let finishReason = '';
    let responseLength = 0;
    for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
      const requestBody = attempt === 0
        ? body
        : { ...body, generationConfig: { ...body.generationConfig, temperature: 0 } };
      let res: Response;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(attempt === 0 ? 8000 : 5000),
          },
        );
      } catch (error) {
        finishReason = error instanceof Error ? error.name : 'FETCH_FAILED';
        break;
      }
      const rawResponse = await res.text();
      if (!res.ok) {
        finishReason = `HTTP_${res.status}`;
        responseLength = rawResponse.length;
        break;
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
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'website-content',
        operation: 'judge_urls_parse_response',
        severity: 'error',
        title: 'Website content URL matching was unavailable',
        error: new Error(`Gemini URL matching did not complete (${finishReason}).`),
        context: { productName: String(product.name).slice(0, 200), candidateUrlCount: validUrls.length, finishReason, responseLength },
      });
      return NextResponse.json({
        success: true,
        validUrlFound: false,
        assessmentUnavailable: true,
        rankedUrls: validUrls.map(url => ({
          url,
          keep: false,
          reason: 'Automatic matching was inconclusive. Review this candidate to continue.',
        })),
      });
    }

    const parsedRankedUrls = (Array.isArray(parsed.rankedUrls) ? parsed.rankedUrls : [])
      .filter((entry: any) => entry?.url?.trim() && validUrls.includes(String(entry.url).trim()))
      .map((entry: any) => ({
        url: String(entry.url).trim(),
        keep: entry.keep === true,
        reason: String(entry.reason ?? '').trim(),
      }));
    const decisionByUrl = new Map(parsedRankedUrls.map((entry: any) => [entry.url, entry]));
    const rankedUrls = validUrls.map(url => decisionByUrl.get(url) ?? ({
      url,
      keep: false,
      reason: 'The AI did not select this candidate.',
    }));
    const validUrlFound = rankedUrls.some((entry: any) => entry.keep);

    return NextResponse.json({ success: true, validUrlFound, rankedUrls });
  } catch (e: any) {
    console.error('[judge-urls]', e);
    return NextResponse.json({ error: e.message ?? 'Internal server error' }, { status: 500 });
  }
}
