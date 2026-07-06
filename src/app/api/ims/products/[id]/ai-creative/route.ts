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
import { decrypt }               from '@/lib/encryption';
import fs   from 'fs';
import path from 'path';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

const SYSTEM_PROMPT = `You are an expert AI image prompt engineer specialising in product photography compositing.

Your task is to write precise prompts for an AI image generator (Nano Banana / Gemini image model) that will composite or recompose the actual provided reference images — you are NOT inventing anything. The product, model, and backdrop images are all real and are attached as references for the AI image generator.

Core rules:
- The product image IS provided — describe it accurately, do NOT invent it
- The model or backdrop template IS provided — describe what you see in it, do NOT invent it
- Your prompt must instruct the AI to COMBINE the references: place the real product on/with the real model or backdrop
- For wearable products: describe them being worn by the model shown in the reference
- For handheld or usable products: describe the model using or holding the product
- For backdrop compositing: place the product naturally within the scene shown
- Maintain photographic realism, correct scale, and natural lighting
- Keep the brand's visual identity, tone, and colour palette

Format: Write a single, detailed, ready-to-use generation prompt in a code block. Be specific about how the product and template relate — lighting direction, product placement, pose adjustments. The AI generator will receive all reference images alongside your prompt.`;
Format your final ready-to-use prompt clearly in a code block.`;

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
    referenceImages = [],   // [{ data: base64, mimeType, label }]
    includeBrandProfile = true,
    includeBusinessInfo = true,
    history = [],
  } = body;
  const businessId = session.businessId as string;
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
        input.push({ type: 'image', data: img.data, mime_type: img.mimeType });
      }
      input.push({ type: 'text', text: cleanPrompt });

      const interaction = await (ai as any).interactions.create({
        model: imageModel,
        input: input.length === 1 ? cleanPrompt : input,
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

  return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
}
