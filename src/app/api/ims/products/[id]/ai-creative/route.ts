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
import os   from 'os';

// Allow long-running AI generations (pro models with large prompts can take a while)
// before the platform kills the request.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

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

// Extract the first complete, balanced JSON object from a string that may contain
// code fences, prose, or trailing content after the closing brace. Brace-depth
// scan that respects string literals and escapes — robust against trailing text.
function extractFirstJsonObject(input: string): string | null {
  let s = (input ?? '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonLike(input: string): any | null {
  const jsonStr = extractFirstJsonObject(input);
  if (!jsonStr) return null;
  try { return JSON.parse(jsonStr); } catch {}
  try {
    return JSON.parse(jsonStr.replace(/,\s*([}\]])/g, '$1'));
  } catch { return null; }
}

function coerceText(value: any): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(coerceText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    for (const key of ['html', 'bodyHtml', 'body_html', 'content', 'text', 'value', 'description']) {
      const nested = coerceText(value[key]);
      if (nested) return nested;
    }
  }
  return '';
}

function pickText(obj: any, paths: string[][]): string {
  for (const path of paths) {
    let cur = obj;
    for (const key of path) cur = cur?.[key];
    const text = coerceText(cur);
    if (text) return text;
  }
  return '';
}

function buildDescriptionFromSections(obj: any): string {
  const sections = obj?.sections ?? obj?.descriptionSections ?? obj?.description_sections;
  if (!Array.isArray(sections)) return '';
  return sections.map((section: any) => {
    const heading = coerceText(section.heading ?? section.title ?? section.label);
    const body = coerceText(section.body ?? section.content ?? section.text ?? section.paragraph);
    const bullets = Array.isArray(section.bullets ?? section.items)
      ? (section.bullets ?? section.items).map((b: any) => `<li>${coerceText(b)}</li>`).filter((b: string) => b !== '<li></li>').join('')
      : '';
    return [heading ? `<h3>${heading}</h3>` : '', body ? `<p>${body}</p>` : '', bullets ? `<ul>${bullets}</ul>` : ''].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n');
}

function extractQuotedJsonString(raw: string, keys: string[]): string {
  for (const key of keys) {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i');
    const match = raw.match(re);
    if (match?.[1]) {
      try { return JSON.parse(`"${match[1]}"`); }
      catch { return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
    }
  }
  return '';
}

function normaliseGeneratedText(parsedInput: any, raw: string) {
  const parsed = Array.isArray(parsedInput) ? parsedInput[0] : parsedInput;
  const title = pickText(parsed, [
    ['title'], ['product_title'], ['productTitle'], ['name'], ['content', 'title'], ['generatedContent', 'title'],
  ]);
  const rawDescription = pickText(parsed, [
    ['description'], ['websiteDescription'], ['website_description'], ['product_description'], ['productDescription'],
    ['body_html'], ['bodyHtml'], ['htmlDescription'], ['descriptionHtml'], ['html'],
    ['content', 'description'], ['content', 'websiteDescription'], ['generatedContent', 'description'], ['generatedContent', 'websiteDescription'],
  ]) || buildDescriptionFromSections(parsed) || extractQuotedJsonString(raw, ['description', 'websiteDescription', 'website_description', 'body_html', 'bodyHtml']);
  const rawTags = parsed?.tags ?? parsed?.product_tags ?? parsed?.productTags ?? parsed?.keywords ?? parsed?.content?.tags ?? parsed?.generatedContent?.tags ?? [];
  const tags = Array.isArray(rawTags)
    ? rawTags.map((t: any) => String(t).trim()).filter(Boolean)
    : typeof rawTags === 'string'
      ? rawTags.split(',').map(t => t.trim()).filter(Boolean)
      : [];
  const imagePrompt = pickText(parsed, [
    ['imagePrompt'], ['image_prompt'], ['imageGenerationPrompt'], ['suggested_prompt'], ['suggestedPrompt'], ['content', 'imagePrompt'], ['generatedContent', 'imagePrompt'],
  ]);
  return { title, description: wrapBareParagraphs(rawDescription), tags, imagePrompt };
}

// Ensure every prose paragraph is wrapped in <p>…</p> so spacing renders correctly.
// Models often return bare text between <h3> headings; the website generator wraps
// prose in <p>. This normalises the AI-creative output to match.
function wrapBareParagraphs(html: string): string {
  if (!html || typeof html !== 'string') return html;
  const lines = html.split('\n');
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue; // block tags provide the spacing; drop blank lines
    const lower = line.toLowerCase();
    if (lower.startsWith('<ul') || lower.startsWith('<ol')) inList = true;
    // Any line that begins with a tag (heading, list, list-item, closing tag, already-<p>) is left as-is
    if (line.startsWith('<')) {
      out.push(line);
      if (lower.startsWith('</ul') || lower.startsWith('</ol')) inList = false;
      continue;
    }
    // Bare prose — wrap it (unless we're inside a list, where stray text is rare)
    out.push(inList ? line : `<p>${line}</p>`);
  }
  return out.join('\n');
}

function buildTemplateHtmlRules(tmpl: any): string {
  if (!tmpl) return '';
  const rules: string[] = [];
  // Always require prose paragraphs to be wrapped in <p> tags (matches the website generator's output/spacing)
  rules.push(`- Wrap EVERY paragraph of prose in <p>…</p> tags. Never leave bare text between headings — each intro/body paragraph must be inside its own <p> element.`);
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

// ── Reusable brand / product context builders (shared across image, video, text) ──

// Brand identity + brand profile as a formatted text block.
async function fetchBrandBlock(businessId: string, includeBusinessInfo: boolean, includeBrandProfile: boolean): Promise<string> {
  const sections: string[] = [];
  if (includeBusinessInfo) {
    try {
      const info = await BusinessInfoRepository.get(businessId);
      if (info?.brand_name) {
        sections.push(`=== BRAND IDENTITY ===\nBrand: ${info.brand_name}${info.brand_url ? `\nWebsite: ${info.brand_url}` : ''}`);
      }
    } catch {}
  }
  if (includeBrandProfile) {
    try {
      const bp = await BrandProfileRepository.get(businessId);
      if (bp) {
        const lines = [
          bp.tone           && `Tone: ${bp.tone}`,
          bp.demographics   && `Target Audience: ${bp.demographics}`,
          bp.uvp            && `Brand UVP: ${bp.uvp}`,
          bp.brand_colours  && `Brand Colours: ${bp.brand_colours}`,
          bp.detailed_brand_aesthetic && `Visual Aesthetic: ${bp.detailed_brand_aesthetic}`,
          bp.praises        && `What customers love: ${bp.praises}`,
        ].filter(Boolean) as string[];
        if (lines.length) sections.push(`=== BRAND PROFILE ===\n${lines.join('\n')}`);
      }
    } catch {}
  }
  return sections.join('\n\n');
}

// Similar/reference products on the site — their text as a style reference.
async function fetchSimilarProductsBlock(similarProductIds: string[]): Promise<string> {
  if (!Array.isArray(similarProductIds) || similarProductIds.length === 0) return '';
  try {
    const ids = similarProductIds.slice(0, 6);
    const placeholders = ids.map(() => '?').join(',');
    const rows = await imsQuery<any>(
      `SELECT name, description, tags FROM ims_products WHERE product_id IN (${placeholders})`,
      ids,
    );
    if (!rows.length) return '';
    const blocks = rows.map((r: any, i: number) => {
      const plainDesc = String(r.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
      return `Sibling ${i + 1}: ${r.name}\nTags: ${r.tags ?? ''}\nDescription: ${plainDesc}`;
    });
    return `=== REFERENCE PRODUCTS ON SITE (match their voice, structure, formatting and style; DO NOT copy their specific facts, designs or dimensions) ===\n${blocks.join('\n\n')}`;
  } catch { return ''; }
}

const IMAGE_SYSTEM_FRAMING = `You are a professional product photographer and retoucher creating a single on-brand product image.
Follow the brand's visual identity, colour palette and aesthetic provided in the context.

Reference image naming conventions — honour the role indicated by the label prefix:
• Product-N: The ACTUAL product — reproduce exactly (unchanged design/colours/graphics/shape).
• Model-Name: Person reference — use their exact face/body/identity; if Product ref present, dress them in it.
• Backdrop-Name: Background only — place product on/within it; do NOT copy any products from it.
• Pose-Name: Pose reference — model adopts this exact stance/limb positions/body angle.
• Scene-Name: Environment/scene reference — set composition in this scene's mood and atmosphere.
• OTHERPRODUCT-Name: Style reference only — match framing/presentation; do NOT reproduce this product.
• UPLOADPhoto-Name: Uploaded creative reference — match its style and context.

Core rules:
- Reproduce the PRODUCT reference exactly — never alter its design, colours, graphics or shape.
- NEVER keep products/garments from any non-Product reference.
- For wearable items: dress the model (exact face/body from MODEL ref) in the product from PRODUCT ref.
- For backdrop: place the product on/in it naturally; do NOT import any objects from the backdrop.
- Match reference lighting, shadows and perspective. No watermarks or invented text. Photographic realism.`;

const SYSTEM_PROMPT = `You are an expert AI image prompt engineer specialising in product photography compositing.

Your task is to write precise prompts for an AI image generator (Nano Banana / Gemini image model) that will composite the actual provided reference images.

Reference image naming conventions — each label prefix defines the role:
• Product-N: The ACTUAL product that MUST appear in the output, unchanged — its real design, colours, textures, print/graphics, logos and shape.
• Model-Name: Person reference — provides ONLY the person's face, body, skin tone and identity.
• Backdrop-Name: Background/setting reference — provides ONLY the backdrop/environment.
• Pose-Name: Pose reference — the model should adopt this exact stance, limb positions and body angle.
• Scene-Name: Scene/environment reference — sets the environmental context and mood.
• OTHERPRODUCT-Name: Style/presentation reference — match its creative framing and composition style; do NOT reproduce the product shown in it.
• UPLOADPhoto-Name: Uploaded reference — use as a creative/style brief.

Core rules (state these explicitly in every prompt you write):
- Use the product ONLY from the PRODUCT reference. Reproduce it exactly.
- NEVER take, keep or copy any product/garment/item shown in any non-Product reference.
- For wearable/clothing products: dress the model (exact face/body/skin from MODEL ref) in the product from PRODUCT ref — not the clothing in the MODEL ref. Fit naturally with correct scale and drape.
- For backdrop compositing: place the PRODUCT-reference product within the backdrop naturally; do not import any product from the backdrop.
- If a POSE ref is present: the model must adopt that pose.
- If an OTHERPRODUCT or UPLOADPhoto ref is present: match their creative style and framing.
- Match the reference lighting, shadows and perspective. Maintain photographic realism.

Format: Write a single, detailed, ready-to-use generation prompt in a code block. Be explicit about each reference's role.`;

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
    additionalInstructions = '',
    similarProductIds = [],
    previewOnly = false,
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
    // Guard: never overwrite an existing field with a blank value.
    const nonEmpty = (v: any) => Array.isArray(v) ? v.length > 0 : (typeof v === 'string' ? v.trim().length > 0 : v != null);
    try {
      const updates: string[] = [];
      const vals: any[] = [];
      if (nonEmpty(title))       { updates.push('name = ?');        vals.push(title); }
      if (nonEmpty(description)) { updates.push('description = ?'); vals.push(description); }
      if (nonEmpty(tags))        { updates.push('tags = ?');        vals.push(Array.isArray(tags) ? tags.join(', ') : tags); }
      if (!updates.length) return NextResponse.json({ error: 'Nothing to save (all provided fields were empty).' }, { status: 400 });
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

  // ── SEARCH-PRODUCTS: type-to-filter list of same-brand products ────────────
  if (mode === 'search-products') {
    const q = String(body.query ?? '').trim();
    const sameTypeOnly = !!body.sameTypeOnly;
    try {
      const cur = await imsQuery<{ brand: string | null; product_type: string | null; category: string | null; subcategory: string | null }>(
        'SELECT brand, product_type, category, subcategory FROM ims_products WHERE product_id = ? LIMIT 1', [productId],
      );
      const brand = cur[0]?.brand ?? '';
      const params2: any[] = [businessId, productId];
      let where = 'business_id = ? AND product_id <> ? AND is_active = 1';
      if (sameTypeOnly) {
        const type = cur[0]?.product_type?.trim();
        const category = cur[0]?.category?.trim();
        const subcategory = cur[0]?.subcategory?.trim();
        if (type) { where += ' AND product_type = ?'; params2.push(type); }
        else if (subcategory) { where += ' AND subcategory = ?'; params2.push(subcategory); }
        else if (category) { where += ' AND category = ?'; params2.push(category); }
        else if (brand) { where += ' AND brand = ?'; params2.push(brand); }
      } else if (brand) {
        where += ' AND brand = ?'; params2.push(brand);
      }
      if (q) { where += ' AND (name LIKE ? OR tags LIKE ?)'; params2.push(`%${q}%`, `%${q}%`); }
      const rows = await imsQuery<any>(
        `SELECT product_id, name, brand, product_type, category, subcategory FROM ims_products WHERE ${where} ORDER BY name LIMIT 30`,
        params2,
      );
      return NextResponse.json({ success: true, brand, products: rows });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e?.message ?? 'Search failed' }, { status: 500 });
    }
  }


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

    // Assemble on-brand context (system framing + brand profile + similar products + additional instructions)
    const brandBlock   = await fetchBrandBlock(businessId, includeBusinessInfo, includeBrandProfile);
    const siblingBlock = await fetchSimilarProductsBlock(similarProductIds);
    const contextParts = [brandBlock, siblingBlock].filter(Boolean).join('\n\n');
    const addl = typeof additionalInstructions === 'string' && additionalInstructions.trim()
      ? `\n\n=== ADDITIONAL INSTRUCTIONS (must be factored in) ===\n${additionalInstructions.trim()}` : '';
    const framing = `${IMAGE_SYSTEM_FRAMING}${contextParts ? `\n\n${contextParts}` : ''}${addl}`;

    // Preview-only: return the assembled prompt without generating
    if (previewOnly) {
      return NextResponse.json({
        success: true,
        preview: {
          model: imageModel,
          systemPrompt: IMAGE_SYSTEM_FRAMING,
          contextBlock: `${contextParts}${addl}`.trim(),
          referenceImages: referenceImages.map((r: any) => r.label ?? 'image'),
          userMessage: cleanPrompt,
          templatesIncluded: false,
        },
      });
    }

    try {
      const input: any[] = [];
      // Lead with the brand framing + context so the model factors it in
      input.push({ type: 'text', text: framing });
      for (const img of referenceImages) {
        // Label each reference with its role based on naming convention prefix
        const label = typeof img.label === 'string' ? img.label : 'reference';
        const isProduct      = label.startsWith('Product-') || label.startsWith('Product #') || label.startsWith('Product ');
        const isModel        = label.startsWith('Model-');
        const isBackdrop     = label.startsWith('Backdrop-');
        const isPose         = label.startsWith('Pose-');
        const isScene        = label.startsWith('Scene-');
        const isOtherProduct = label.startsWith('OTHERPRODUCT-');
        const isUpload       = label.startsWith('UPLOADPhoto-');
        const roleLabel = isProduct
          ? `PRODUCT reference (${label}) — reproduce this exact product in the output. Take its design, colours, graphics, textures and shape exactly as shown:`
          : isModel
          ? `MODEL reference (${label}) — use this person's exact face, body, skin tone and identity. Do NOT keep any clothing/product worn in this image:`
          : isBackdrop
          ? `BACKDROP reference (${label}) — use only this background/setting. Do NOT import any products or items shown in it:`
          : isPose
          ? `POSE reference (${label}) — the model should adopt this specific pose/stance/body angle exactly:`
          : isScene
          ? `SCENE reference (${label}) — set the composition within this type of scene/environment, matching its mood and atmosphere:`
          : isOtherProduct
          ? `OTHER PRODUCT STYLE reference (${label}) — use the creative style, framing, and presentation approach from this image. Do NOT reproduce the product shown here:`
          : isUpload
          ? `UPLOADED reference (${label}) — use this as a style/creative brief for the composition and context:`
          : `TEMPLATE reference (${label}) — use only its scene/person/backdrop. Do NOT keep any product shown in it:`;
        input.push({ type: 'text', text: roleLabel });
        input.push({ type: 'image', data: img.data, mime_type: img.mimeType });
      }
      input.push({ type: 'text', text: cleanPrompt });

      const interaction = await (ai as any).interactions.create({
        model: imageModel,
        input,
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

    const brandBlock   = await fetchBrandBlock(businessId, includeBusinessInfo, includeBrandProfile);
    const siblingBlock = await fetchSimilarProductsBlock(similarProductIds);
    const contextParts = [brandBlock, siblingBlock].filter(Boolean).join('\n\n');
    const addl = typeof additionalInstructions === 'string' && additionalInstructions.trim()
      ? `\n\n=== ADDITIONAL INSTRUCTIONS (must be factored in) ===\n${additionalInstructions.trim()}` : '';
    const framing = `${IMAGE_SYSTEM_FRAMING}${contextParts ? `\n\n${contextParts}` : ''}${addl}`;

    if (previewOnly) {
      return NextResponse.json({
        success: true,
        preview: {
          model: videoModel,
          systemPrompt: IMAGE_SYSTEM_FRAMING,
          contextBlock: `${contextParts}${addl}`.trim(),
          referenceImages: referenceImages.map((r: any) => r.label ?? 'image'),
          userMessage: cleanPrompt,
          templatesIncluded: false,
        },
      });
    }

    try {
      const videoRefs = (Array.isArray(referenceImages) ? referenceImages : [])
        .filter((img: any) => img?.data && img?.mimeType)
        .slice(0, 3);
      const refLabels = videoRefs.map((img: any, i: number) => `${i + 1}. ${img.label ?? `Reference-${i + 1}`}`).join('\n');
      const videoPrompt = [
        framing,
        refLabels ? `=== SELECTED VISUAL REFERENCES PASSED TO VEO ===\n${refLabels}\n\nUse these images as visual anchors. If a Product-* reference is present, the exact product from that image must remain the hero subject throughout the video.` : '',
        `=== VIDEO BRIEF ===\n${cleanPrompt}`,
        '=== NATURAL PRODUCT VIDEO REQUIREMENTS ===\nMake the output look like a real product promotional video, not a synthetic AI clip. Use physically plausible motion, stable product shape, coherent perspective, realistic shadows and reflections, natural camera movement, consistent lighting, believable fabric/material behavior, and natural human movement if people appear. Avoid morphing, flicker, melting details, rubbery motion, uncanny faces or hands, fake text, invented logos, extra packaging, and over-polished plastic lighting.',
        'Keep the video tightly related to the provided product, brand aesthetic, and selected references. Do not introduce unrelated products, logos, text overlays, watermarks, packaging, or background scenes that conflict with the references.',
      ].filter(Boolean).join('\n\n');
      const veoAspectRatio = aspectRatio === '9:16' ? '9:16' : '16:9';

      if (String(videoModel).startsWith('gemini-omni')) {
        const omniInput: any[] = [];
        for (const img of videoRefs) {
          omniInput.push({ type: 'image', data: img.data, mime_type: img.mimeType });
        }
        const omniPrompt = [
          videoRefs.length
            ? `Use the ${videoRefs.length} provided image reference(s) as visual anchors for the video. ${videoRefs.map((img: any, i: number) => `<IMAGE_REF_${i}> = ${img.label ?? `Reference-${i + 1}`}`).join('; ')}.`
            : '',
          videoPrompt,
          videoRefs.length ? 'Use the given image(s) as references for video generation. The images should not be used as unrelated inspiration; preserve the product and brand context. In a single continuous shot unless explicitly requested otherwise.' : 'In a single continuous shot unless explicitly requested otherwise.',
        ].filter(Boolean).join('\n\n');
        omniInput.push({ type: 'text', text: omniPrompt });

        const interaction = await (ai as any).interactions.create({
          model: videoModel,
          input: omniInput.length > 1 ? omniInput : omniPrompt,
          response_format: { type: 'video', aspect_ratio: veoAspectRatio },
          generation_config: { video_config: { task: videoRefs.length ? 'reference_to_video' : 'text_to_video' } },
        });
        const outVideo = interaction?.output_video;
        if (outVideo?.data) {
          return NextResponse.json({ success: true, videoData: outVideo.data, mimeType: outVideo.mimeType ?? outVideo.mime_type ?? 'video/mp4' });
        }
        for (const step of (interaction?.steps ?? [])) {
          for (const block of (step?.content ?? [])) {
            if (block?.type === 'video' && block?.data) {
              return NextResponse.json({ success: true, videoData: block.data, mimeType: block.mimeType ?? block.mime_type ?? 'video/mp4' });
            }
          }
        }
        return NextResponse.json({ error: 'No video returned by Gemini Omni. Try a shorter, more specific prompt.' }, { status: 500 });
      }

      // Veo uses a long-running operation API — not generateContent.
      // Start the generation, then poll until done.
      let operation = await (ai as any).models.generateVideos({
        model: videoModel,
        prompt: videoPrompt,
        config: {
          numberOfVideos: 1,
          aspectRatio: veoAspectRatio,
          negativePrompt: 'AI-looking video, synthetic motion, morphing, flicker, melting details, warped hands, extra fingers, uncanny face, rubbery fabric, unstable geometry, distorted product, unrelated product, different product, wrong item, extra logo, watermark, captions, text overlay, fake text, invented packaging, distorted brand marks, random people, unrelated background, over-glossy plastic lighting',
          ...(videoRefs.length > 0 ? {
            referenceImages: videoRefs.map((img: any) => ({
              image: { imageBytes: img.data, mimeType: img.mimeType },
              referenceType: String(img.label ?? '').startsWith('OTHERPRODUCT-') || String(img.label ?? '').startsWith('Scene-') || String(img.label ?? '').startsWith('Backdrop-') ? 'STYLE' : 'ASSET',
            })),
          } : {}),
        },
      });

      // Poll every 12 s; give up after ~240 s (leaving margin inside 300 s maxDuration)
      const deadline = Date.now() + 240_000;
      while (!operation.done && Date.now() < deadline) {
        await new Promise<void>(r => setTimeout(r, 12_000));
        operation = await (ai as any).operations.get({ operation });
      }

      if (!operation.done) {
        return NextResponse.json({ error: 'Video generation timed out. Please try again.' }, { status: 504 });
      }

      const videos: any[] = operation.response?.generatedVideos ?? [];
      if (!videos.length) {
        return NextResponse.json({ error: 'No video returned. Try a shorter, more specific prompt.' }, { status: 500 });
      }

      const mimeType: string =
        videos[0]?.mimeType ?? videos[0]?.video?.mimeType ?? 'video/mp4';

      // Download the video from Google Files API and return as base64 so the
      // client can preview / save it without exposing a protected Gemini Files URI.
      const tmpPath = path.join(os.tmpdir(), `marketoir-veo-${productId}-${Date.now()}.mp4`);
      try {
        await (ai as any).files.download({ file: videos[0], downloadPath: tmpPath });
        const buf = fs.readFileSync(tmpPath);
        return NextResponse.json({ success: true, videoData: buf.toString('base64'), mimeType });
      } catch (downloadErr: any) {
        return NextResponse.json({ error: `Video generated but could not be downloaded for preview: ${downloadErr?.message ?? 'download failed'}` }, { status: 500 });
      } finally {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
      }
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

      if (shopifyProductId && !isVideo) {
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

      // Local volume storage — mirrors the /images/upload route pattern
      const ext      = isVideo ? 'mp4' : (mediaType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg');
      const safeId   = productId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeId}-ai-${Date.now()}.${ext}`;
      const dir      = path.join(process.env.UPLOAD_BASE_PATH ?? './uploads', businessId, 'product-images');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), Buffer.from(mediaData, 'base64'));

      // Register with source:'volume' + drive_file_id so the /file serve route can find it
      const imageId = await ImsImagesRepo.add(productId, '', 'volume', {
        driveFileId: filename,
        altText,
        isPrimary: false,
      });
      const publicUrl = `/api/ims/products/${productId}/images/${imageId}/file`;
      await ImsImagesRepo.updateUrl(imageId, publicUrl);
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
    } = body;
    let textModelId = textModel || 'gemini-2.5-flash';
    try {
      const conn = await ConnectionsRepository.get(businessId) as any;
      if (conn?.gemini_model) textModelId = textModel || conn.gemini_model;
    } catch {}

    const sections: string[] = [];

    // Brand context (shared builder)
    const brandBlock = await fetchBrandBlock(businessId, includeBusinessInfo, includeBrandProfile);
    if (brandBlock) sections.push(brandBlock);

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
      if (existing) sections.push(`=== EXISTING PRODUCT CONTENT (use as a factual source — it often contains real product details like materials, dimensions, brand and features. Improve and rewrite it to fit the templates; preserve accurate facts, do not invent new specs) ===\n${existing}`);
    }

    // Similar products on the site (same brand) — style reference
    const siblingBlock = await fetchSimilarProductsBlock(similarProductIds);
    if (siblingBlock) sections.push(siblingBlock);

    // Additional user instructions — must be factored in
    if (typeof additionalInstructions === 'string' && additionalInstructions.trim()) {
      sections.push(`=== ADDITIONAL INSTRUCTIONS (must be factored in) ===\n${additionalInstructions.trim()}`);
    }

    const contextBlock = sections.join('\n\n');
    const textSystemPrompt = `You are an expert e-commerce product content writer for a retail brand.
Analyse the provided product reference images and brand context to write compelling, SEO-optimised product content.
Use the brand's tone, visual aesthetic, and target audience to guide the writing.
When brand website/content templates are provided, MATCH their structure, formatting, tone and style closely.
When ADDITIONAL INSTRUCTIONS are provided, you MUST factor them into every field you generate.

You MUST respond with ONLY a single valid JSON object. No markdown. No prose. No code fences. No extra keys. Start immediately with { and end with }.
ALL FOUR keys (title, description, tags, imagePrompt) are MANDATORY and must be non-empty in every response — never omit the description.
When EXISTING PRODUCT CONTENT is provided, treat it as the primary factual source: reuse its accurate product details (materials, dimensions, brand, features) when writing the new title, description and tags, and improve the wording to match the templates.

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
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              imagePrompt: { type: 'string' },
            },
            required: ['title', 'description', 'tags', 'imagePrompt'],
          },
        },
      });
      const raw = (result.text ?? '').trim();
      const parsed = parseJsonLike(raw);
      if (!parsed) {
        return NextResponse.json({ error: `AI did not return JSON. Response started with: ${raw.slice(0, 80)}` }, { status: 500 });
      }
      const { title, description, tags, imagePrompt } = normaliseGeneratedText(parsed, raw);
      if (!description.trim()) {
        return NextResponse.json({
          error: 'AI returned JSON but no usable description field. Try enabling existing text or product images.',
          debug: { returnedKeys: parsed && typeof parsed === 'object' ? Object.keys(Array.isArray(parsed) ? parsed[0] ?? {} : parsed) : [] },
        }, { status: 500 });
      }
      return NextResponse.json({ success: true, title, description, tags, imagePrompt, templatesIncluded: templatesFound });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message?.slice(0, 300) ?? 'Text generation failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
}
