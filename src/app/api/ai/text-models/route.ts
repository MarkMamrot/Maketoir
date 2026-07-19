/**
 * GET /api/ai/text-models
 * Returns available text generation models from the Google AI API.
 * Filters to standard Gemini chat/content models (excludes image, video, embed, aqa variants).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const sessionCookie = cookies().get('marketoir_session');
  if (!sessionCookie?.value) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`Google API error ${res.status}`);
    const data = await res.json();

    const allModels: { name: string; displayName: string; supportedGenerationMethods?: string[] }[] = data.models ?? [];

    const EXCLUDE = ['image', 'video', 'omni', 'embed', 'aqa', 'vision', 'tts', 'audio', 'live', 'learnlm'];
    const textModels = allModels
      .filter(m => {
        const id = m.name.toLowerCase();
        if (!id.includes('gemini')) return false;
        if (EXCLUDE.some(ex => id.includes(ex))) return false;
        if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) return false;
        return true;
      })
      .map(m => ({
        id:          m.name.replace(/^models\//, ''),
        displayName: m.displayName ?? m.name.replace(/^models\//, ''),
      }));

    // Deduplicate: prefer canonical undated version
    const seen = new Map<string, { id: string; displayName: string }>();
    for (const m of textModels) {
      const base = m.id.replace(/-\d{4,8}$/, '');
      if (!seen.has(base) || (!m.id.match(/-\d{4,8}$/) && seen.get(base)!.id.match(/-\d{4,8}$/))) {
        seen.set(base, m);
      }
    }

    const deduped = Array.from(seen.values()).sort((a, b) => {
      // Preferred order
      const order = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    return NextResponse.json({ models: deduped });
  } catch (e: any) {
    return NextResponse.json({
      models: [
        { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
        { id: 'gemini-2.5-pro',   displayName: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
        { id: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' },
        { id: 'gemini-1.5-pro',   displayName: 'Gemini 1.5 Pro' },
      ],
      fallback: true,
      error: e?.message,
    });
  }
}
