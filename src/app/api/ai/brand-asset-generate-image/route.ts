/**
 * POST /api/ai/brand-asset-generate-image
 * Generates an image from a prompt using the selected Nano Banana model.
 * Returns { success, imageData (base64), mimeType } or { error }.
 */
import { NextResponse } from 'next/server';
import { createTrackedGoogleGenAI } from '@/lib/ai/billing/googleGateway';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminSession } from '@/lib/sessionUtils';

// Nano Banana models that support image output via Interactions API
const IMAGE_MODELS = new Set([
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
]);

const CATEGORY_RENDER_RULES: Record<string, string> = {
  models: 'Render a reusable model reference on a clean solid pure-white background. Use plain unbranded solid neutral clothing unless the prompt explicitly requests a general on-brand clothing style. No products, graphics, logos, readable text, props, scenery, or brand-colour treatment.',
  poses: 'Render a reusable pose reference with a generic model in plain fitted neutral clothing on a clean solid pure-white background. Prioritise readable body position. No products, graphics, logos, text, props, or scenery.',
  backdrops: 'Render an empty product-ready backdrop with useful negative space. No people, products, logos, readable text, campaign messaging, or narrative props.',
  scenes: 'Render a clean environment plate with practical space for products or models to be added later. No people, products, logos, readable text, campaign messaging, or campaign-specific props.',
  templates: 'Render only the requested reusable composition structure. Do not invent products, logos, readable text, or a campaign narrative.',
};

const REFERENCE_INSTRUCTIONS: Record<string, string> = {
  models: 'MODEL reference — use this person\'s exact face, body, skin tone, and identity. Do not retain their clothing unless requested:',
  poses: 'POSE reference — reproduce the body position, stance, limb placement, head angle, and weight distribution. Do not retain the person\'s identity or clothing:',
  backdrops: 'BACKDROP reference — use the background, setting, lighting, surfaces, and perspective. Do not retain people, products, logos, or text:',
  scenes: 'SCENE reference — use the environmental context, composition, mood, lighting, and atmosphere. Do not retain people, products, logos, or text:',
};

export async function POST(req: Request) {
  const auth = requireAdminSession();
  if (auth.response) return auth.response;
  const businessId = auth.user.businessId;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });

  const {
    prompt: rawPrompt,
    imageModel = 'gemini-3.1-flash-image',
    category,
    referenceImageData,
    referenceImageMime,
    forceWhiteBackground,
  } = await req.json();
  if (!rawPrompt?.trim()) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });

  // The AI response may contain explanatory text around the actual image prompt.
  // Extract content from the FIRST code block if present — that's the clean prompt.
  const codeBlockMatch = rawPrompt.match(/```(?:[^\n]*)?\n([\s\S]+?)```/);
  let prompt = codeBlockMatch ? codeBlockMatch[1].trim() : rawPrompt.trim();

  const categoryRule = CATEGORY_RENDER_RULES[String(category ?? '').toLowerCase()];
  if (categoryRule) prompt += `\n\nREUSABLE ASSET REQUIREMENTS: ${categoryRule}`;

  if (forceWhiteBackground) {
    prompt += '\n\nIMPORTANT: Place the subject on a clean, solid pure-white background. No shadows, no gradients, no textures, no props.';
  }

  const model = IMAGE_MODELS.has(imageModel) ? imageModel : 'gemini-3.1-flash-image';
  const normalizedCategory = String(category ?? '').toLowerCase();

  const ai = createTrackedGoogleGenAI(apiKey, { businessId, area: 'product_creative_image', operation: 'generate_brand_asset_image', actorType: 'user' });

  // Build multimodal input when a reference image is supplied
  const inputPayload: any = (referenceImageData && referenceImageMime)
    ? [
        { type: 'text', text: REFERENCE_INSTRUCTIONS[normalizedCategory] ?? 'REFERENCE image — use this image only to guide the requested reusable asset:' },
        { type: 'image', data: referenceImageData, mime_type: referenceImageMime },
        { type: 'text', text: prompt },
      ]
    : prompt;

  try {
    const interaction = await (ai as any).interactions.create({
      model,
      input: inputPayload,
    });

    // Primary: convenience property
    const img = interaction?.output_image;
    if (img?.data) {
      return NextResponse.json({
        success: true,
        imageData: img.data,
        mimeType: img.mimeType ?? 'image/jpeg',
        model,
      });
    }

    // Fallback: iterate steps for image content blocks
    for (const step of (interaction?.steps ?? [])) {
      if (step?.type === 'model_output') {
        for (const block of (step?.content ?? [])) {
          if (block?.type === 'image' && block?.data) {
            return NextResponse.json({
              success: true,
              imageData: block.data,
              mimeType: block.mimeType ?? 'image/jpeg',
              model,
            });
          }
        }
      }
    }

    // Nothing found — return debug info so we can see what came back
    const noImageError = new Error('No image returned by the model.');
    await reportRuntimeIssue({
      businessId,
      source: 'brand-assets',
      operation: 'generate-image',
      title: 'Brand asset image generation returned no image',
      error: noImageError,
      context: { category: normalizedCategory, model, hasReferenceImage: !!referenceImageData },
    });
    return NextResponse.json({
      error: noImageError.message,
      debug: {
        hasOutputImage: !!interaction?.output_image,
        outputText: interaction?.output_text?.slice(0, 200) ?? null,
        stepTypes: (interaction?.steps ?? []).map((s: any) => s?.type),
      },
    }, { status: 500 });

  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await reportRuntimeIssue({
      businessId,
      source: 'brand-assets',
      operation: 'generate-image',
      title: 'Brand asset image generation failed',
      error: e,
      context: { category: normalizedCategory, model, hasReferenceImage: !!referenceImageData },
    });
    return NextResponse.json({
      error: msg.length > 300 ? msg.slice(0, 300) + '…' : msg,
    }, { status: 500 });
  }
}
