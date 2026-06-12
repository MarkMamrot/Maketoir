import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const { brand, productName } = await req.json();
    if (!brand || !productName) {
      return NextResponse.json({ error: 'brand and productName are required.' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });
    }

    const restUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const body = {
      contents: [{ role: 'user', parts: [{ text: `Find the official product page and top major retailer listings for "${productName}" by ${brand}. I need accurate URLs to specific product pages (not category or search result pages). List up to 6 page URLs.` }] }],
      tools: [{ google_search: {} }],
    };

    const restRes = await fetch(restUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    const rawText = await restRes.text();

    if (!restRes.ok) {
      return NextResponse.json({ error: `Gemini API error: ${restRes.status}`, detail: rawText.slice(0, 500) }, { status: 500 });
    }

    let json: any;
    try {
      json = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ error: 'Failed to parse Gemini response', detail: rawText.slice(0, 500) }, { status: 500 });
    }

    const chunks: { title: string; uri: string }[] = (json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
      .map((c: any) => ({ title: c.web?.title ?? '', uri: c.web?.uri ?? '' }))
      .filter((c: any) => c.uri);

    return NextResponse.json({ chunks });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unexpected error' }, { status: 500 });
  }
}
