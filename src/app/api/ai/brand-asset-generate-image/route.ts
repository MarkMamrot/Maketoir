/**
 * POST /api/ai/brand-asset-generate-image
 * Generates an image from a prompt using the selected Nano Banana model.
 * Returns { success, imageData (base64), mimeType } or { error }.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleGenAI } from '@google/genai';

// Nano Banana models that support image output via Interactions API
const IMAGE_MODELS = new Set([
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
  'imagen-4.0-generate-001',
  'imagen-4.0-ultra-generate-001',
  'imagen-4.0-fast-generate-001',
]);

export async function POST(req: Request) {
  const sessionCookie = cookies().get('marketoir_session');
  if (!sessionCookie?.value) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });

  const {
    prompt: rawPrompt,
    imageModel = 'gemini-3.1-flash-image',
    referenceImageData,
    referenceImageMime,
    forceWhiteBackground,
  } = await req.json();
  if (!rawPrompt?.trim()) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });

  // The AI response may contain explanatory text around the actual image prompt.
  // Extract content from the FIRST code block if present — that's the clean prompt.
  const codeBlockMatch = rawPrompt.match(/```(?:[^\n]*)?\n([\s\S]+?)```/);
  let prompt = codeBlockMatch ? codeBlockMatch[1].trim() : rawPrompt.trim();

  if (forceWhiteBackground) {
    prompt += '\n\nIMPORTANT: Place the subject on a clean, solid pure-white background. No shadows, no gradients, no textures, no props.';
  }

  const model = IMAGE_MODELS.has(imageModel) ? imageModel : 'gemini-3.1-flash-image';

  const ai = new GoogleGenAI({ apiKey });

  // Build multimodal input when a reference image is supplied
  const inputPayload: any = (referenceImageData && referenceImageMime)
    ? [
        { type: 'text', text: 'MODEL reference — use this person\'s exact face, body, skin tone, and identity as the model in the generated image. Do NOT keep any clothing worn in this photo:' },
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
    return NextResponse.json({
      error: 'No image returned by the model.',
      debug: {
        hasOutputImage: !!interaction?.output_image,
        outputText: interaction?.output_text?.slice(0, 200) ?? null,
        stepTypes: (interaction?.steps ?? []).map((s: any) => s?.type),
      },
    }, { status: 500 });

  } catch (e: any) {
    const msg = e?.message ?? String(e);
    return NextResponse.json({
      error: msg.length > 300 ? msg.slice(0, 300) + '…' : msg,
    }, { status: 500 });
  }
}
