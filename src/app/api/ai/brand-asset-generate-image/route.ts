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

  const { prompt, imageModel = 'gemini-3.1-flash-image' } = await req.json();
  if (!prompt?.trim()) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });

  const model = IMAGE_MODELS.has(imageModel) ? imageModel : 'gemini-3.1-flash-image';

  const ai = new GoogleGenAI({ apiKey });

  try {
    const interaction = await (ai as any).interactions.create({
      model,
      input: prompt.trim(),
      response_format: { type: 'image' },
    });

    const img = interaction?.output_image;
    if (!img?.data) {
      return NextResponse.json({ error: 'No image returned by the model. Try a different or more specific prompt.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      imageData: img.data,           // base64 string
      mimeType: img.mimeType ?? 'image/png',
      model,
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    return NextResponse.json({
      error: msg.length > 300 ? msg.slice(0, 300) + '…' : msg,
    }, { status: 500 });
  }
}
