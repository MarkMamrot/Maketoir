/**
 * POST /api/ai/brand-asset-chat
 *
 * AI creative director chat for generating on-brand asset prompts and templates.
 * Accepts only brand-relevant context (no products, no sales data).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleGenAI } from '@google/genai';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { resolveBusinessAiModel } from '@/lib/ai/businessModelPreferences';
import { BrandProfileRepository } from '@/lib/db/BrandProfileRepository';
import { BusinessInfoRepository } from '@/lib/db/BusinessInfoRepository';
import { query as dbQuery } from '@/services/MySQLService';

const SYSTEM_PROMPT = `You create clean, reusable base assets for a retail brand's future product photography and advertising compositions.

The BRAND CONTEXT is guidance, not a list of objects to render. Use it only to infer the brand-appropriate audience, casting, grooming, expression, mood, realism, photographic finish, and general environment style. Never reproduce example products or scenes from the context.

Core rules for every category:
- Create a neutral base asset that can later be combined with changing products, garments, campaign copy, and layouts.
- Do not add products, merchandise, product graphics, logos, brand names, readable text, packaging, campaign messaging, decorative motifs, or brand-colour treatments.
- Do not add props unless the user explicitly requests one and it is essential to the asset itself.
- Do not invent a campaign concept or a narrative scene.
- Follow the user's explicit subject and modifier choices. Infer only missing details from the brand context.
- Keep the composition visually uncluttered and the subject clearly isolated or separable.

Category rules:
- MODELS: Define casting, age range, appearance, hair, grooming, makeup level, expression, body framing, and photographic finish. Use plain, unbranded, solid neutral clothing unless the user explicitly asks for on-brand clothing; even then, describe only its general fashion sensibility, with no logos, graphics, products, or signature brand colours. Use a simple natural stance and a clean pure-white background. Do not build a lifestyle setting around the model.
- POSES: Create a clear pose reference using a generic model in plain fitted neutral clothing on a pure-white background. Focus on body position, weight distribution, limbs, hand placement, head angle, gaze, and expression. Do not add scenery or props.
- BACKDROPS: Create an empty, product-ready background with appropriate light, surface, depth, and restrained atmosphere. No people, products, furniture used as a focal prop, signs, logos, text, or narrative activity. Leave useful negative space.
- SCENES: Create a clean, plausible environment plate suitable for adding products or models later. No people, products, logos, readable text, or campaign-specific props. Keep visual hierarchy simple and preserve practical placement space.
- TEMPLATES: Create a reusable composition specification with neutral placeholders rather than a finished campaign concept.

Return exactly one ready-to-use image-generation prompt as plain text. Do not use markdown, headings, code fences, explanations, alternatives, or follow-up suggestions.`;

const IMAGE_MODEL_NOTES: Record<string, string> = {
  // ── Nano Banana family (current / recommended) ──────────────────────────────
  'gemini-3.1-flash-image':
    'Target: Nano Banana 2 (Gemini 3.1 Flash Image). Use direct natural language and include only details needed to define the reusable asset.',

  'gemini-3-pro-image':
    'Target: Nano Banana Pro (Gemini 3 Pro Image). Use precise natural language and include only details needed to define the reusable asset.',

  'gemini-3.1-flash-lite-image':
    'Target: Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image). Keep the prompt concise and avoid complex multi-element compositions.',

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
    previewOnly            = false,
    history = [],
  } = await req.json();

  if (!databaseId || (!prompt?.trim() && !previewOnly)) {
    return NextResponse.json({ error: 'databaseId and prompt are required' }, { status: 400 });
  }

  // Get Gemini model preference
  let modelId = resolveBusinessAiModel(null, 'businessIntelligence');
  try {
    const conn = await ConnectionsRepository.get(databaseId);
    modelId = resolveBusinessAiModel(conn, 'businessIntelligence');
  } catch {}

  // Assemble context sections
  const sections: string[] = [];

  if (includeBusinessInfo) {
    try {
      const info = await BusinessInfoRepository.get(databaseId);
      sections.push([
        '=== BRAND IDENTITY ===',
        info?.brand_name ? `Brand: ${info.brand_name}` : 'Brand: (not set — add in Setup › Business Info)',
        info?.brand_url  ? `Website: ${info.brand_url}` : '',
      ].filter(Boolean).join('\n'));
    } catch (e: any) { sections.push(`=== BRAND IDENTITY ===\n(error: ${e?.message ?? String(e)})`); }
  }

  if (includeBrandProfile) {
    try {
      const bp = await BrandProfileRepository.get(databaseId);
      if (bp) {
        const lines = [
          '=== BRAND PROFILE ===',
          bp.uvp                 ? `Unique Value Proposition: ${bp.uvp}` : '',
          bp.tone                ? `Brand Tone & Voice: ${bp.tone}` : 'Brand Tone: (not set)',
          bp.demographics        ? `Target Demographics: ${bp.demographics}` : 'Target Demographics: (not set)',
          bp.brand_history       ? `Brand history: ${bp.brand_history}` : '',
          bp.detailed_brand_aesthetic ? `Detailed Brand Aesthetic: ${bp.detailed_brand_aesthetic}` : '',
        ].filter(Boolean);
        sections.push(lines.join('\n'));
      } else {
        sections.push('=== BRAND PROFILE ===\n(not set up — go to Setup › Brand Profile to generate with AI)');
      }
    } catch (e: any) { sections.push(`=== BRAND PROFILE ===\n(error: ${e?.message ?? String(e)})`); }
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

  // Build prompt with context
  const modelNote = IMAGE_MODEL_NOTES[imageModel] ?? 'Target: a general-purpose AI image generator. Write clear, detailed prompts in natural language.';
  const contextBlock = [
    `=== TARGET IMAGE GENERATION MODEL ===\n${modelNote}`,
    ...sections,
  ].map(s => s.trim()).filter(Boolean).join('\n\n');

  const fullPrompt = `Asset category: ${String(category ?? '').toUpperCase()}\n\n--- BRAND CONTEXT ---\n${contextBlock}\n--- END CONTEXT ---\n\nUser request:\n${(prompt ?? '').trim()}`;

  // previewOnly: return assembled context without calling Gemini
  if (previewOnly) {
    return NextResponse.json({
      success: true,
      contextBlock,
      systemPrompt: SYSTEM_PROMPT,
      debug: {
        databaseId,
        sessionBusinessId: session.businessId ?? session.databaseId ?? '(not in session)',
        sectionsFound: sections.length,
        toggles: { includeBusinessInfo, includeBrandProfile, includeExistingAssets },
      },
    });
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
      ? `Model "${modelId}" not found — update your AI model in Intel & Automation settings.`
      : `AI error: ${detail.slice(0, 200)}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
