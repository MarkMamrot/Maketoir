/**
 * POST /api/ims/products/[id]/ai-creative
 *
 * mode "chat"  — AI prompt chat with brand context + reference images
 * mode "image" — generate image via Nano Banana (reference images passed inline)
 * mode "video" — generate video via Veo
 * mode "save"  — persist base64 media to product (volume or Shopify)
 */
import { NextResponse }          from 'next/server';
import { cookies }               from 'next/headers';
import { GoogleGenAI }           from '@google/genai';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { BrandProfileRepository }from '@/lib/db/BrandProfileRepository';
import { BusinessInfoRepository }from '@/lib/db/BusinessInfoRepository';
import { ImsImagesRepo }         from '@/lib/ims/ImsRepository';
import { imsQuery }              from '@/services/IMSMySQLService';
import { GoogleSheetsService }   from '@/services/GoogleSheetsService';
import { decrypt }               from '@/lib/encryption';
import fs   from 'fs';
import path from 'path';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

// ── Web Field Templates (from Foresight Google Sheets) ───────────────────────
async function getWebFieldTemplates(databaseId: string): Promise<{ description: any; title: any; tags: any }> {
  const empty = { description: null, title: null, tags: null };
  try {
    const sheets = new GoogleSheetsService();
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

function buildTemplateHtmlRules(tmpl: any): string {
  if (!tmpl) return '';
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
  return rules.length ? `\nHTML RULES (mandatory):\n${rules.join('\n')}` : '';
}

const SYSTEM_PROMPT = `You are an expert AI image prompt engineer specialising in product photography compositing.

Your task is to write precise prompts for an AI image generator (Nano Banana / Gemini image model) that will composite the actual provided reference images — you are NOT inventing anything. The images fall into two roles:
- PRODUCT reference (labelled "Product #..."): the ACTUAL product that MUST appear in the output, unchanged — its real design, colours, textures, print/graphics, logos and shape.
- TEMPLATE reference (models, backdrops): provides ONLY the scene — the person (face, body, pose, skin) and/or the backdrop/environment.

Core rules (state these explicitly in every prompt you write):
- Use the product ONLY from the PRODUCT reference. Reproduce it exactly.
- NEVER take, keep or copy any product/garment/item shown in a TEMPLATE reference. The clothing or product in the template must be completely REPLACED by the product from the PRODUCT reference.
- For wearable/clothing products: the model (exact face, body, pose and skin from the template) must be shown WEARING the product from the PRODUCT reference — not the garment in the template. Fit naturally with correct scale, drape and proportion.
- For backdrop compositing: place the PRODUCT-reference product within the template's scene naturally; do not import any product from the template.
- Match the template's lighting, shadows and perspective. Maintain photographic realism and accurate product colours, materials and scale.
- Keep the brand's visual identity, tone, and colour palette.

Format: Write a single, detailed, ready-to-use generation prompt in a code block. Be explicit that the product comes from the PRODUCT reference and the person/scene comes from the TEMPLATE reference.`;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });

  const body = await req.json();
  const {
    mode,
    prompt = '',
    imageModel  = 'gemini-3.1-flash-image',
    videoModel  = 'veo-3.1-generate-preview',
    aspectRatio = '1:1',
    referenceImages = [],   // [{ data: base64, mimeType, label }]
    includeBrandProfile = true,
    includeBusinessInfo = true,
    textModel = 'gemini-2.5-flash',
    history = [],
  } = body;
  const businessId = session.businessId as string;

  // ── FETCH-REF-IMAGE: server-side image proxy (bypasses browser CORS) ───────
  if (mode === 'fetch-ref-image') {
    const { url } = body;
    if (!url) return NextResponse.json({ success: false, error: 'url required' });
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Marketoir/1.0' } });
      if (!res.ok) return NextResponse.json({ success: false, error: `Fetch failed: ${res.status}` });
      const mime = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
      const buf  = Buffer.from(await res.arrayBuffer());
      return NextResponse.json({ success: true, data: buf.toString('base64'), mimeType: mime });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message ?? 'Failed to fetch image' });
    }
  }

  // ── SAVE-TEXT: apply generated title/description/tags to product ───────────
  if (mode === 'save-text') {
    const { title, description, tags } = body;
    try {
      const updates: string[] = [];
      const vals: any[] = [];
      if (title       !== undefined) { updates.push('name = ?');        vals.push(title); }
      if (description !== undefined) { updates.push('description = ?'); vals.push(description); }
      if (tags        !== undefined) { updates.push('tags = ?');        vals.push(Array.isArray(tags) ? tags.join(', ') : tags); }
      if (!updates.length) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 });
      vals.push(params.id);
      const { imsExecute } = await import('@/services/IMSMySQLService');
      await imsExecute(`UPDATE ims_products SET ${updates.join(', ')}, updated_at = NOW() WHERE product_id = ?`, vals);
      return NextResponse.json({ success: true });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Save failed' }, { status: 500 });
    }
  }

  const productId  = params.id;
  const ai = new GoogleGenAI({ apiKey });

  // ── CHAT ──────────────────────────────────────────────────────────────────
  if (mode === 'chat') {
    let modelId = 'gemini-2.5-flash';
    try {
      const conn = await ConnectionsRepository.get(businessId) as any;
      if (conn?.gemini_model) modelId = conn.gemini_model;
    } catch {}

    const sections: string[] = [];
    if (includeBusinessInfo) {
      try {
        const info = await BusinessInfoRepository.get(businessId);
        if (info?.brand_name) {
          sections.push(['=== BRAND IDENTITY ===',
            `Brand: ${info.brand_name}`,
            info.brand_url ? `Website: ${info.brand_url}` : '',
          ].filter(Boolean).join('\n'));
        }
      } catch {}
    }
    if (includeBrandProfile) {
      try {
        const bp = await BrandProfileRepository.get(businessId);
        if (bp) {
          const lines = ['=== BRAND PROFILE ===',
            bp.tone           && `Tone: ${bp.tone}`,
            bp.demographics   && `Demographics: ${bp.demographics}`,
            bp.brand_colours  && `Brand Colours: ${bp.brand_colours}`,
            bp.detailed_brand_aesthetic && `Visual Aesthetic: ${bp.detailed_brand_aesthetic}`,
          ].filter(Boolean) as string[];
          if (lines.length > 1) sections.push(lines.join('\n'));
        }
      } catch {}
    }

    const ctxBlock = sections.join('\n\n');
    const userText = [
      ctxBlock && `--- BRAND CONTEXT ---\n${ctxBlock}\n--- END CONTEXT ---`,
      referenceImages.length && `Reference images provided: ${referenceImages.map((r: any) => r.label).join(', ')}`,
      `User request:\n${prompt}`,
    ].filter(Boolean).join('\n\n');

    const contents: any[] = [];
    for (const msg of history) {
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
    }
    const parts: any[] = [];
    for (const img of referenceImages) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
    parts.push({ text: userText });
    contents.push({ role: 'user', parts });

    try {
      const result = await (ai as any).models.generateContent({
        model: modelId, systemInstruction: SYSTEM_PROMPT, contents,
      });
      return NextResponse.json({ success: true, response: result.text ?? '' });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Chat error' }, { status: 500 });
    }
  }

  // ── IMAGE ─────────────────────────────────────────────────────────────────
  if (mode === 'image') {
    const codeMatch = prompt.match(/```(?:[^\n]*)?\n([\s\S]+?)```/);
    const cleanPrompt = codeMatch ? codeMatch[1].trim() : prompt.trim();
    try {
      const input: any[] = [];
      for (const img of referenceImages) {
        // Label each reference so the model knows its role (product vs template)
        const isProduct = typeof img.label === 'string' && img.label.toLowerCase().startsWith('product');
        const roleLabel = isProduct
          ? `PRODUCT reference (${img.label}) — reproduce this exact product in the output:`
          : `TEMPLATE reference (${img.label ?? 'template'}) — use only its scene/person/backdrop, NOT any product shown in it:`;
        input.push({ type: 'text', text: roleLabel });
        input.push({ type: 'image', data: img.data, mime_type: img.mimeType });
      }
      input.push({ type: 'text', text: cleanPrompt });

      const interaction = await (ai as any).interactions.create({
        model: imageModel,
        input: input.length === 1 ? cleanPrompt : input,
        response_format: { type: 'image', aspect_ratio: aspectRatio },
      });
      const imgOut = interaction?.output_image;
      if (!imgOut?.data) {
        return NextResponse.json({ error: 'No image returned. Adjust your prompt.', debug: { outputText: interaction?.output_text?.slice(0, 200) } }, { status: 500 });
      }
      return NextResponse.json({ success: true, imageData: imgOut.data, mimeType: imgOut.mimeType ?? 'image/jpeg' });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message?.slice(0, 300) ?? 'Image generation failed' }, { status: 500 });
    }
  }

  // ── VIDEO ─────────────────────────────────────────────────────────────────
  if (mode === 'video') {
    const codeMatch = prompt.match(/```(?:[^\n]*)?\n([\s\S]+?)```/);
    const cleanPrompt = codeMatch ? codeMatch[1].trim() : prompt.trim();
    try {
      const parts: any[] = [];
      for (const img of referenceImages) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }
      parts.push({ text: cleanPrompt });

      const result = await (ai as any).models.generateContent({
        model: videoModel,
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['video'] },
      });
      for (const part of result?.candidates?.[0]?.content?.parts ?? []) {
        if (part?.inlineData?.data)  return NextResponse.json({ success: true, videoData: part.inlineData.data, mimeType: part.inlineData.mimeType ?? 'video/mp4' });
        if (part?.fileData?.fileUri) return NextResponse.json({ success: true, videoUri: part.fileData.fileUri, mimeType: part.fileData.mimeType ?? 'video/mp4' });
      }
      return NextResponse.json({ error: 'No video returned. Try a shorter, more specific prompt.' }, { status: 500 });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message?.slice(0, 300) ?? 'Video generation failed' }, { status: 500 });
    }
  }

  // ── SAVE ──────────────────────────────────────────────────────────────────
  if (mode === 'save') {
    const { mediaData, mediaType = 'image/jpeg', isVideo = false, altText = 'AI generated' } = body;
    if (!mediaData) return NextResponse.json({ error: 'mediaData required' }, { status: 400 });

    try {
      // Check Shopify product ID
      const pRows = await imsQuery<{ shopify_product_id: string | null }>(
        'SELECT shopify_product_id FROM ims_products WHERE product_id = ?', [productId],
      );
      const shopifyProductId = pRows[0]?.shopify_product_id;

      if (shopifyProductId) {
        try {
          const conn = await ConnectionsRepository.get(businessId) as any;
          const encToken = conn?.shopify_access_token ?? '';
          const shopId   = conn?.shopify_shop_id ?? '';
          if (encToken && shopId) {
            const token = decrypt(encToken);
            const shop  = shopId.replace(/\.myshopify\.com$/, '');
            const ext   = isVideo ? 'mp4' : (mediaType.split('/')[1] ?? 'jpg');
            const shopRes = await fetch(
              `https://${shop}.myshopify.com/admin/api/2024-01/products/${shopifyProductId}/images.json`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
                body: JSON.stringify({ image: { attachment: mediaData, filename: `ai-${Date.now()}.${ext}`, alt: altText } }),
              },
            );
            if (shopRes.ok) {
              const shopData = await shopRes.json();
              const shopifyUrl = shopData.image?.src;
              if (shopifyUrl) {
                await ImsImagesRepo.add(productId, shopifyUrl, 'shopify', { altText, isPrimary: false });
                return NextResponse.json({ success: true, url: shopifyUrl, source: 'shopify' });
              }
            }
          }
        } catch (shopErr: any) {
          console.error('[ai-creative save] Shopify push failed:', shopErr.message);
          // Fall through to local storage
        }
      }

      // Local volume storage
      const ext      = isVideo ? 'mp4' : (mediaType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg');
      const safeId   = productId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeId}-ai-${Date.now()}.${ext}`;
      const dir      = path.join(process.env.UPLOAD_BASE_PATH ?? './uploads', businessId, 'product-images');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), Buffer.from(mediaData, 'base64'));

      const publicUrl = `/api/ims/media/${businessId}/product-images/${filename}`;
      await ImsImagesRepo.add(productId, publicUrl, 'external', { altText, isPrimary: false });
      return NextResponse.json({ success: true, url: publicUrl, source: 'volume' });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Save failed' }, { status: 500 });
    }
  }

  // ── TEXT: generate title + description + tags + image prompt ────────────────
  if (mode === 'text') {
    const {
      existingTitle = '', existingDescription = '', existingTags = '',
      includeExistingText = false,
      includeWebTemplates = true,
      previewOnly = false,
    } = body;
    let textModelId = textModel || 'gemini-2.5-flash';
    try {
      const conn = await ConnectionsRepository.get(businessId) as any;
      if (conn?.gemini_model) textModelId = textModel || conn.gemini_model;
    } catch {}

    const sections: string[] = [];

    // Brand context
    try {
      const info = await BusinessInfoRepository.get(businessId);
      if (info?.brand_name) sections.push(`Brand: ${info.brand_name}${info.brand_url ? ` (${info.brand_url})` : ''}`);
    } catch {}
    try {
      const bp = await BrandProfileRepository.get(businessId);
      if (bp) {
        const lines = [
          bp.tone           && `Writing Tone: ${bp.tone}`,
          bp.demographics   && `Target Audience: ${bp.demographics}`,
          bp.uvp            && `Brand UVP: ${bp.uvp}`,
          bp.brand_colours  && `Brand Colours: ${bp.brand_colours}`,
          bp.detailed_brand_aesthetic && `Visual Aesthetic: ${bp.detailed_brand_aesthetic}`,
          bp.praises        && `What customers love: ${bp.praises}`,
        ].filter(Boolean) as string[];
        if (lines.length) sections.push(lines.join('\n'));
      }
    } catch {}

    // Foresight Web Field Templates (title / description / tags schemas from Google Sheets)
    let templatesFound = false;
    if (includeWebTemplates) {
    try {
      const tmpl = await getWebFieldTemplates(businessId);
      const blocks: string[] = [];
      if (tmpl.title) {
        blocks.push(`TITLE TEMPLATE (follow this structure/rules):\n${typeof tmpl.title === 'string' ? tmpl.title : JSON.stringify(tmpl.title, null, 2)}`);
      }
      if (tmpl.description) {
        blocks.push(`DESCRIPTION TEMPLATE (follow this structure/rules):\n${typeof tmpl.description === 'string' ? tmpl.description : JSON.stringify(tmpl.description, null, 2)}${buildTemplateHtmlRules(tmpl.description)}`);
      }
      if (tmpl.tags) {
        blocks.push(`TAGS TEMPLATE (follow this structure/rules):\n${typeof tmpl.tags === 'string' ? tmpl.tags : JSON.stringify(tmpl.tags, null, 2)}`);
      }
      if (blocks.length) {
        templatesFound = true;
        sections.push(`=== BRAND WEB FIELD TEMPLATES (match these structures, formatting and tone exactly) ===\n${blocks.join('\n\n')}`);
      }
    } catch {}
    } // end includeWebTemplates

    // Existing product text (if requested)
    if (includeExistingText && (existingTitle || existingDescription || existingTags)) {
      const existing = [
        existingTitle       && `Existing Title: ${existingTitle}`,
        existingTags        && `Existing Tags: ${existingTags}`,
        existingDescription && `Existing Description (HTML):\n${existingDescription}`,
      ].filter(Boolean).join('\n');
      if (existing) sections.push(`=== EXISTING PRODUCT CONTENT ===\n${existing}`);
    }

    const contextBlock = sections.join('\n\n');
    const textSystemPrompt = `You are an expert e-commerce product content writer for a retail brand.
Analyse the provided product reference images and brand context to write compelling, SEO-optimised product content.
Use the brand's tone, visual aesthetic, and target audience to guide the writing.
When brand website/content templates are provided, MATCH their structure, formatting, tone and style closely.

You MUST respond with ONLY a single valid JSON object. No markdown. No prose. No code fences. No extra keys. Start immediately with { and end with }.

Required JSON structure (all four keys are MANDATORY):
{
  "title": "concise keyword-rich product title, max 70 characters",
  "description": "<h3>Feature Heading</h3><p>Opening sentence about the product.</p><ul><li>Key feature 1</li><li>Key feature 2</li></ul><p>Closing brand-aligned sentence.</p>",
  "tags": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5", "keyword6", "keyword7", "keyword8", "keyword9", "keyword10"],
  "imagePrompt": "A ready-to-use image generation prompt for an ideal hero shot of this product"
}

Rules:
- title: max 70 chars, keyword-rich, no brand name
- description: valid HTML using only h3, p, ul, li tags; 150-300 words total; highlight features, benefits, materials
- tags: 10-15 SEO keyword strings as a JSON array
- imagePrompt: single string, photographic realism, suitable for an AI image generator`;

    const userMessage = (contextBlock ? `${contextBlock}\n\n` : '') + `Generate compelling product content for the product shown in the reference image(s).\n\nIMPORTANT: Your entire response must be a single raw JSON object. Start with { and end with }. No markdown, no explanation, no code fences.`;

    // Preview-only: return the assembled prompt without calling the AI
    if (previewOnly) {
      return NextResponse.json({
        success: true,
        preview: {
          model: textModelId,
          systemPrompt: textSystemPrompt,
          contextBlock,
          userMessage,
          referenceImages: referenceImages.map((r: any) => r.label ?? 'image'),
          templatesIncluded: templatesFound,
        },
      });
    }

    const parts: any[] = [];
    for (const img of referenceImages) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
    parts.push({ text: userMessage });

    try {
      const result = await (ai as any).models.generateContent({
        model: textModelId,
        systemInstruction: textSystemPrompt,
        contents: [{ role: 'user', parts }],
        config: { responseMimeType: 'application/json' },
      });
      const raw = (result.text ?? '').trim();
      // Gemini may still wrap in code fences despite responseMimeType — handle both
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      let jsonStr = fenceMatch ? fenceMatch[1].trim() : raw;
      if (!jsonStr.startsWith('{')) {
        const start = jsonStr.indexOf('{');
        const end   = jsonStr.lastIndexOf('}');
        if (start !== -1 && end > start) jsonStr = jsonStr.slice(start, end + 1);
      }
      const parsed = JSON.parse(jsonStr);
      // Normalise key names — models sometimes use alternatives
      const title       = parsed.title       ?? parsed.product_title   ?? parsed.name          ?? '';
      const description = parsed.description ?? parsed.product_description ?? parsed.body_html ?? '';
      const rawTags     = parsed.tags        ?? parsed.product_tags    ?? parsed.keywords      ?? [];
      // Tags must always be an array of strings — models sometimes return a comma-separated string.
      const tags = Array.isArray(rawTags)
        ? rawTags.map((t: any) => String(t).trim()).filter(Boolean)
        : typeof rawTags === 'string'
          ? rawTags.split(',').map(t => t.trim()).filter(Boolean)
          : [];
      const imagePrompt = parsed.imagePrompt ?? parsed.image_prompt    ?? parsed.imageGenerationPrompt ?? parsed.suggested_prompt ?? '';
      return NextResponse.json({ success: true, title, description, tags, imagePrompt, templatesIncluded: templatesFound });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message?.slice(0, 300) ?? 'Text generation failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
}
