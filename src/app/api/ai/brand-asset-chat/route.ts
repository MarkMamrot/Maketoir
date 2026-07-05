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
import { BrandProfileRepository } from '@/lib/db/BrandProfileRepository';
import { BusinessInfoRepository } from '@/lib/db/BusinessInfoRepository';
import { query as dbQuery } from '@/services/MySQLService';

function getSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

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

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });

  const {
    databaseId,
    prompt,
    category,
    includeBrandProfile = true,
    includeBusinessInfo  = true,
    includeExistingAssets = false,
    history = [],
  } = await req.json();

  if (!databaseId || !prompt?.trim()) {
    return NextResponse.json({ error: 'databaseId and prompt are required' }, { status: 400 });
  }

  // Get Gemini model preference
  let modelId = 'gemini-2.5-flash-preview-04-17';
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

  // Build prompt with context
  const contextBlock = sections.length > 0
    ? `\n\n--- BRAND CONTEXT ---\n${sections.join('\n\n')}\n--- END CONTEXT ---\n`
    : '';

  const fullPrompt = contextBlock + '\n\nUser request:\n' + prompt.trim();

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
