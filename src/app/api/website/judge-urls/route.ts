import { NextResponse } from 'next/server';
import { trackedGenerateContentRest } from '@/lib/ai/billing/googleGateway';
import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { parseAiJsonResponse } from '@/lib/website/aiJsonResponse';
import { imsQuery } from '@/services/IMSMySQLService';
import { DEFAULT_URL_JUDGE_MODEL, WEBSITE_AI_SETTING_KEYS, resolveWebsiteTextModel } from '@/lib/website/contentPreferences';

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
 *   rankedUrls:        { url, keep, confidence, preferred, reason }[]
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

    const { databaseId, product, urls, candidates = [], preferredSites = [] } = await req.json();
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
    const modelId = resolveWebsiteTextModel(modelRows[0]?.value, DEFAULT_URL_JUDGE_MODEL);

    const validUrls: string[] = urls.filter((u: any) => typeof u === 'string' && u.trim());
    const preferredDomains = (Array.isArray(preferredSites) ? preferredSites : [])
      .map((site: any) => {
        try { return new URL(String(site).startsWith('http') ? String(site) : `https://${site}`).hostname.replace(/^www\./, ''); }
        catch { return ''; }
      })
      .filter(Boolean);
    const isPreferredUrl = (url: string) => {
      try {
        const hostname = new URL(url).hostname.replace(/^www\./, '');
        return preferredDomains.some((domain: string) => hostname === domain || hostname.endsWith(`.${domain}`));
      } catch { return false; }
    };
    const evidenceByUrl = new Map<string, string>(
      (Array.isArray(candidates) ? candidates : [])
        .filter((candidate: any) => validUrls.includes(String(candidate?.url ?? '').trim()))
        .map((candidate: any) => [
          String(candidate.url).trim(),
          String(candidate.evidence ?? '').trim().slice(0, 1200),
        ]),
    );
    const normaliseIdentity = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const scoreFromSearchEvidence = (url: string) => {
      let decodedUrl = url;
      try { decodedUrl = decodeURIComponent(url); } catch { decodedUrl = url; }
      const combined = normaliseIdentity(`${decodedUrl} ${evidenceByUrl.get(url) ?? ''}`);
      const nameTokens = normaliseIdentity(product.name).split(' ').filter((token: string) => token.length >= 2);
      const brandTokens = normaliseIdentity(product.brand).split(' ').filter((token: string) => token.length >= 2);
      const nameCoverage = nameTokens.length > 0
        ? nameTokens.filter((token: string) => combined.includes(token)).length / nameTokens.length
        : 0;
      const brandMatches = brandTokens.length > 0 && brandTokens.every((token: string) => combined.includes(token));
      const identifier = [product.code, product.barcode, product.styleCode]
        .map(normaliseIdentity)
        .find((value: string) => value.length >= 4 && combined.includes(value));
      const productPath = /\/(?:products?|p|item)\//i.test(url);

      let confidence = 0;
      let reason = 'Search evidence does not identify the exact product.';
      if (identifier) {
        confidence = 95;
        reason = 'The search result contains an exact product identifier.';
      } else if (nameCoverage === 1) {
        confidence = brandMatches ? 92 : 84;
        reason = brandMatches
          ? 'The search result contains the full product name and brand.'
          : 'The search result contains the full product name.';
      } else if (nameCoverage >= 0.75) {
        confidence = brandMatches ? 78 : 68;
        reason = 'The search result strongly matches the product name.';
      } else if (nameCoverage >= 0.6 && brandMatches) {
        confidence = 58;
        reason = 'The search result probably matches the product name and brand.';
      } else if (nameCoverage > 0) {
        confidence = Math.round(nameCoverage * 45);
        reason = 'The search result only partially matches the product name.';
      }

      if (!productPath) confidence = Math.min(confidence, 49);
      return { url, confidence, reason };
    };
    const selectRankedUrls = (scoredUrls: { url: string; confidence: number; reason: string }[]) => {
      const preferredSelection = scoredUrls
        .filter(entry => isPreferredUrl(entry.url) && entry.confidence >= 50)
        .sort((a, b) => b.confidence - a.confidence)[0];
      const bestSelection = scoredUrls
        .filter(entry => entry.confidence >= 50)
        .sort((a, b) => b.confidence - a.confidence)[0];
      const selectedUrl = preferredSelection?.url ?? bestSelection?.url ?? '';
      return {
        selectedUrl,
        rankedUrls: scoredUrls.map(entry => ({
          ...entry,
          keep: entry.url === selectedUrl,
          preferred: isPreferredUrl(entry.url),
        })),
      };
    };

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

For each URL score how confidently the URL and result evidence identify an actual listing page for THIS EXACT product by ${product.brand}.

Rules:
- confidence is an integer from 0 to 100.
- 90-100 = exact product identity is explicit in the URL/title/snippet.
- 70-89 = strong exact-product match with only minor wording differences.
- 50-69 = probable exact-product page, sufficient for automatic selection.
- 1-49 = ambiguous, incomplete, or possibly a related product.
- 0 = category/search/social page, clearly wrong product, or unrelated page.
- Score every candidate independently. Multiple exact retailer pages may all score highly.
- Supplier or brand pages are more authoritative, but confidence must still reflect exact-product identity.
- Do NOT invent URLs not in the list above.

═══════════════════════════════════════════════════════
RETURN FORMAT
═══════════════════════════════════════════════════════

Return ONLY valid JSON — no markdown fences, no extra text:
{
  "rankedUrls": [
    { "url": "<exact url from the list above>", "confidence": 85, "reason": "<1 sentence>" }
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
        res = await trackedGenerateContentRest(apiKey, modelId, requestBody, {
          businessId: session.businessId,
          area: 'website_content',
          operation: 'judge_product_urls',
          actorType: 'user',
        }, AbortSignal.timeout(attempt === 0 ? 8000 : 5000));
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
      const fallbackSelection = selectRankedUrls(validUrls.map(scoreFromSearchEvidence));
      if (finishReason === 'STOP' && responseLength === 0) {
        return NextResponse.json({
          success: true,
          validUrlFound: Boolean(fallbackSelection.selectedUrl),
          selectedUrl: fallbackSelection.selectedUrl,
          assessmentUnavailable: !fallbackSelection.selectedUrl,
          assessmentMethod: 'search-evidence',
          rankedUrls: fallbackSelection.rankedUrls,
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
        validUrlFound: Boolean(fallbackSelection.selectedUrl),
        selectedUrl: fallbackSelection.selectedUrl,
        assessmentUnavailable: !fallbackSelection.selectedUrl,
        assessmentMethod: 'search-evidence',
        rankedUrls: fallbackSelection.rankedUrls,
      });
    }

    const parsedRankedUrls = (Array.isArray(parsed.rankedUrls) ? parsed.rankedUrls : [])
      .filter((entry: any) => entry?.url?.trim() && validUrls.includes(String(entry.url).trim()))
      .map((entry: any) => ({
        url: String(entry.url).trim(),
        confidence: Number.isFinite(Number(entry.confidence))
          ? Math.max(0, Math.min(100, Math.round(Number(entry.confidence))))
          : entry.keep === true ? 100 : 0,
        reason: String(entry.reason ?? '').trim(),
      }));
    const decisionByUrl = new Map(parsedRankedUrls.map((entry: any) => [entry.url, entry]));
    const scoredUrls = validUrls.map(url => decisionByUrl.get(url) ?? ({
      url,
      confidence: 0,
      reason: 'The AI did not assess this candidate.',
    }));
    const selection = selectRankedUrls(scoredUrls);
    const validUrlFound = Boolean(selection.selectedUrl);

    return NextResponse.json({
      success: true,
      validUrlFound,
      selectedUrl: selection.selectedUrl,
      assessmentMethod: 'ai',
      rankedUrls: selection.rankedUrls,
    });
  } catch (e: any) {
    console.error('[judge-urls]', e);
    return NextResponse.json({ error: e.message ?? 'Internal server error' }, { status: 500 });
  }
}
