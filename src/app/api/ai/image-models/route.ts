/**
 * GET /api/ai/image-models
 * Returns available image generation models from the Google AI API.
 * Filters to models whose name contains 'image' (Nano Banana family + Imagen).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const sessionCookie = cookies().get('marketoir_session');
  if (!sessionCookie?.value) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 3600 } }); // cache 1 hour
    if (!res.ok) throw new Error(`Google API error ${res.status}`);
    const data = await res.json();

    const allModels: { name: string; displayName: string; description?: string }[] = data.models ?? [];

    // Keep only image generation models (name contains 'image')
    const imageModels = allModels
      .filter(m => m.name.toLowerCase().includes('image'))
      .map(m => ({
        id:          m.name.replace(/^models\//, ''),
        displayName: m.displayName ?? m.name.replace(/^models\//, ''),
        description: m.description ?? '',
      }));

    // Deduplicate: prefer the undated canonical version (no trailing date like -0709).
    // Group by base name (strip trailing -MMYY or -YYYYMMDD suffixes), keep canonical first.
    const seen = new Map<string, { id: string; displayName: string; description: string }>();
    for (const m of imageModels) {
      const base = m.id.replace(/-\d{4,8}$/, ''); // strip date suffix
      if (!seen.has(base) || m.id === base) {
        // prefer the exact canonical id (no date) over a dated variant
        if (!seen.has(base) || (!m.id.match(/-\d{4,8}$/) && seen.get(base)!.id.match(/-\d{4,8}$/))) {
          seen.set(base, m);
        }
      }
    }

    const deduped = Array.from(seen.values())
      .sort((a, b) => {
        if (a.id === 'gemini-3.1-flash-image') return -1;
        if (b.id === 'gemini-3.1-flash-image') return  1;
        return a.displayName.localeCompare(b.displayName);
      });

    return NextResponse.json({ models: deduped });
  } catch (e: any) {
    // On error return a safe static fallback so the UI doesn't break
    return NextResponse.json({
      models: [
        { id: 'gemini-3.1-flash-image',      displayName: 'Nano Banana 2 (Gemini 3.1 Flash Image)' },
        { id: 'gemini-3.1-flash-lite-image',  displayName: 'Nano Banana Lite (Gemini 3.1 Flash Lite Image)' },
        { id: 'gemini-3-pro-image',           displayName: 'Nano Banana Pro (Gemini 3 Pro Image)' },
        { id: 'gemini-2.5-flash-image',       displayName: 'Nano Banana (Gemini 2.5 Flash Image)' },
        { id: 'imagen-4.0-generate-001',      displayName: 'Imagen 4 Standard ⚠️ deprecated' },
        { id: 'imagen-4.0-ultra-generate-001',displayName: 'Imagen 4 Ultra ⚠️ deprecated' },
        { id: 'imagen-4.0-fast-generate-001', displayName: 'Imagen 4 Fast ⚠️ deprecated' },
      ],
      fallback: true,
      error: e?.message,
    });
  }
}
