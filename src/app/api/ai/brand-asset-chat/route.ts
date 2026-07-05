/**
 * POST /api/ai/brand-asset-chat
 *
 * AI creative director chat for generating on-brand asset prompts and templates.
 * Accepts only brand-relevant context (no products, no sales data).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleGenAI } from '@google/genai';

const SYSTEM_PROMPT = `You are a specialist creative director and AI prompt engineer for a fashion/lifestyle retail brand.

Your role is to create precise, on-brand creative templates — model prompts, backdrop descriptions, and visual style guides — that will be used with AI image generators (Midjourney, DALL-E, Stable Diffusion, Flux) to produce consistent branded imagery.

When generating prompts or templates:
- Make them specific, detailed, and immediately usable in an AI image generator
- Incorporate the brand's visual identity, tone, and target demographics
- For MODEL prompts: describe pose, expression, styling, lighting, camera angle in vivid detail
- For BACKDROP prompts: describe environment, lighting, texture, mood, colour palette in detail
- For TEMPLATES: provide a reusable structure with [PRODUCT], [COLOUR], [STYLE] style variables
- Always stay on-brand and avoid generic clichés
- Format your output clearly, with the prompt in a code block for easy copying
- After the main prompt, suggest 2-3 variations

Be concise in your explanations but thorough in the prompts themselves.`;

const IMAGE_MODEL_NOTES: Record<string, string> = {
  // ── Nano Banana family (current / recommended) ──────────────────────────────
  'gemini-3.1-flash-image':
    'Target: Nano Banana 2 (Gemini 3.1 Flash Image). Best all-round model. ' +
    'Supports 4K output, reliable text rendering, up to 10 high-fidelity object references and 4 character references, Google Image Search grounding, and video-to-image. ' +
    'Use rich, detailed prompts in natural language (100–350 words). Describe subject, setting, lighting, camera angle, mood, and colour palette. ' +
    'For model/person prompts include pose, expression, wardrobe detail, and photographic style. ' +
    'Separate key concepts with commas and use photographic/cinematic language.',

  'gemini-3-pro-image':
    'Target: Nano Banana Pro (Gemini 3 Pro Image). Premium model for professional asset production. ' +
    'Features a built-in Thinking process, up to 4K resolution, up to 14 reference images (5 high-fidelity), and the highest world-knowledge accuracy. ' +
    'Write highly detailed, professional-grade prompts (150–500 words). ' +
    'Include brand references, precise colour hex codes, typography notes, stylistic references, and step-by-step composition instructions. ' +
    'Use "Thinking-aware" language: break complex scenes into numbered steps for the model to reason through.',

  'gemini-3.1-flash-lite-image':
    'Target: Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image). Fastest and cheapest model — optimised for speed and scale. ' +
    'Supports 1K resolution only. Not optimised for multiple reference images or multi-turn sequential editing. ' +
    'Keep prompts concise and focused (40–80 words). Prioritise the single most important visual elements. ' +
    'Avoid complex multi-element compositions.',

  'gemini-2.5-flash-image':
    'Target: Nano Banana (Gemini 2.5 Flash Image) — legacy model. ' +
    'Generates 1024px images, optimised for high-volume low-latency tasks. Works best with up to 3 input images. ' +
    'Use clear, direct prompts (50–120 words). Google recommends migrating to Nano Banana 2 Lite for better quality and lower cost.',

  // ── Imagen series (deprecated — shutdown August 17, 2026) ──────────────────
  'imagen-4.0-generate-001':
    '⚠️ DEPRECATED (Imagen 4 Standard — shutdown Aug 17, 2026). Migrate to Nano Banana 2. ' +
    'Use descriptive natural language covering subject, setting, lighting, style, and mood. Aim for 100–300 words.',
  'imagen-4.0-ultra-generate-001':
    '⚠️ DEPRECATED (Imagen 4 Ultra — shutdown Aug 17, 2026). Migrate to Nano Banana Pro. ' +
    'Supports highly detailed photorealistic prompts up to ~480 tokens. Use rich descriptive language, camera settings, and stylistic references.',
  'imagen-4.0-fast-generate-001':
    '⚠️ DEPRECATED (Imagen 4 Fast — shutdown Aug 17, 2026). Migrate to Nano Banana Lite. ' +
    'Keep prompts concise and focused, around 50–100 words.',
};

export async function POST(req: Request) {
  const sessionCookie = cookies().get('marketoir_session');
  if (!sessionCookie?.value) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let session: any;
  try { session = JSON.parse(sessionCookie.value); } catch { return NextResponse.json({ error: 'Unauthorised' }, { status: 401 }); }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });

  const {
    databaseId,
    prompt,
    category,
    imageModel = 'gemini-3.1-flash-image',
    includeBrandProfile    = true,
    includeBusinessInfo    = true,
    includeExistingAssets  = false,
    includeCreativeHistory = false,
    previewOnly            = false,
    history = [],
  } = await req.json();

  if (!databaseId || (!prompt?.trim() && !previewOnly)) {
    return NextResponse.json({ error: 'databaseId and prompt are required' }, { status: 400 });
  }

  // Get Gemini model preference
  let modelId = 'gemini-2.5-flash';
  try {
    const conn = await ConnectionsRepository.get(databaseId) as any;
    if (conn?.gemini_model) modelId = conn.gemini_model;
    else if (conn?.GeminiModel) modelId = conn.GeminiModel;
  } catch {}

  // Assemble context sections
  const sections: string[] = [];

  if (includeBusinessInfo) {
    try {
      const info = await BusinessInfoRepository.get(databaseId);
      if (info) {
        sections.push([
          '=== BRAND IDENTITY ===',
          info.brand_name ? `Brand: ${info.brand_name}` : '',
          info.brand_url  ? `Website: ${info.brand_url}` : '',
        ].filter(Boolean).join('\n'));
      }
    } catch {}
  }

  if (includeBrandProfile) {
    try {
      const bp = await BrandProfileRepository.get(databaseId);
      if (bp) {
        const lines = [
          '=== BRAND PROFILE ===',
          bp.mission             ? `Mission: ${bp.mission}` : '',
          bp.uvp                 ? `Unique Value Proposition: ${bp.uvp}` : '',
          bp.tone                ? `Brand Tone & Voice: ${bp.tone}` : '',
          bp.demographics        ? `Target Demographics: ${bp.demographics}` : '',
          bp.brand_colours       ? `Brand Colours: ${bp.brand_colours}` : '',
          bp.price_positioning   ? `Price Positioning: ${bp.price_positioning}` : '',
          bp.praises             ? `What customers love: ${bp.praises}` : '',
          bp.hero_products       ? `Hero products: ${bp.hero_products}` : '',
          bp.geo                 ? `Key markets: ${bp.geo}` : '',
          bp.brand_history       ? `Brand history: ${bp.brand_history}` : '',
          bp.detailed_brand_aesthetic ? `Detailed Brand Aesthetic: ${bp.detailed_brand_aesthetic}` : '',
        ].filter(Boolean);
        if (lines.length > 1) sections.push(lines.join('\n'));
      }
    } catch {}
  }

  if (includeExistingAssets && category) {
    try {
      const biz = session.businessId ?? session.databaseId ?? '';
      const assets = await dbQuery<{ name: string; content: string }>(
        `SELECT name, content FROM brand_assets WHERE business_id = ? AND category = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 8`,
        [biz, category],
      );
      if (assets.length > 0) {
        const assetLines = [`=== EXISTING ${category.toUpperCase()} PROMPTS (for reference/consistency) ===`];
        assets.forEach((a, i) => { assetLines.push(`\n[${i + 1}] ${a.name}:\n${a.content}`); });
        sections.push(assetLines.join('\n'));
      }
    } catch {}
  }

  if (includeCreativeHistory) {
    try {
      const rows = await dbQuery<{ summary: string | null }>(
        'SELECT summary FROM creative_summaries WHERE business_id = ?',
        [databaseId],
      );
      const brief = rows[0]?.summary?.trim();
      if (brief) sections.push(`=== CREATIVE INTELLIGENCE BRIEF ===\n${brief}`);
    } catch {}
  }

  // Build prompt with context
  const modelNote = IMAGE_MODEL_NOTES[imageModel] ?? 'Target: a general-purpose AI image generator. Write clear, detailed prompts in natural language.';
  const contextBlock = [
    `=== TARGET IMAGE GENERATION MODEL ===\n${modelNote}`,
    ...sections,
  ].map(s => s.trim()).filter(Boolean).join('\n\n');

  const fullPrompt = `--- BRAND CONTEXT ---\n${contextBlock}\n--- END CONTEXT ---\n\nUser request:\n${(prompt ?? '').trim()}`;

  // previewOnly: return assembled context without calling Gemini
  if (previewOnly) {
    return NextResponse.json({ success: true, contextBlock, systemPrompt: SYSTEM_PROMPT });
  }

  // Build conversation history for Gemini
  const contents: any[] = [];

  // Add conversation history
  for (const msg of history) {
    contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
  }

  // Add current prompt
  contents.push({ role: 'user', parts: [{ text: fullPrompt }] });

  const ai = new GoogleGenAI({ apiKey });

  try {
    const result = await ai.models.generateContent({
      model: modelId,
      systemInstruction: SYSTEM_PROMPT,
      contents,
    } as any);

    return NextResponse.json({ success: true, response: result.text ?? '', model: modelId });
  } catch (e: any) {
    const detail = e?.message ?? String(e);
    const msg = detail.includes('404') || detail.includes('not found')
      ? `Model "${modelId}" not found — update your AI model in Foresight settings.`
      : `AI error: ${detail.slice(0, 200)}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
