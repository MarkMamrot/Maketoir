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

    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'TAVILY_API_KEY not configured.' }, { status: 500 });
    }

    const query = `${productName} by ${brand} official product page retailer`;

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: 6,
        search_depth: 'basic',
      }),
      signal: AbortSignal.timeout(15000),
    });

    const rawText = await res.text();

    if (!res.ok) {
      return NextResponse.json({ error: `Tavily API error: ${res.status}`, detail: rawText.slice(0, 500) }, { status: 500 });
    }

    let json: any;
    try {
      json = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ error: 'Failed to parse Tavily response', detail: rawText.slice(0, 500) }, { status: 500 });
    }

    const results: { title: string; url: string; score: number }[] = (json.results ?? [])
      .map((r: any) => ({ title: r.title ?? '', url: r.url ?? '', score: r.score ?? 0 }))
      .filter((r: any) => r.url);

    return NextResponse.json({ results, query });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unexpected error' }, { status: 500 });
  }
}
