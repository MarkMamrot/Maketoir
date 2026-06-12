import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const sessionCookie = cookies().get('marketoir_session');
  if (!sessionCookie?.value) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Gemini API key not configured.' }, { status: 500 });
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=50`,
      { next: { revalidate: 3600 } } // cache for 1 hour
    );

    if (!res.ok) {
      const err = await res.text();
      console.error('Gemini models list error:', err);
      return NextResponse.json({ error: 'Failed to fetch models from Gemini.' }, { status: 500 });
    }

    const data = await res.json();

    const models: { id: string; name: string }[] = (data.models ?? [])
      .filter((m: any) =>
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes('generateContent')
      )
      .map((m: any) => ({
        id: m.name.replace('models/', ''),       // e.g. "gemini-2.0-flash"
        name: m.displayName ?? m.name,           // e.g. "Gemini 2.0 Flash"
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    return NextResponse.json({ models });
  } catch (error: any) {
    console.error('Gemini models route error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
