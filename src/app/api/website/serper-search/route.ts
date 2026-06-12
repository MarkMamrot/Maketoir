import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * POST /api/website/serper-search
 *
 * Queries the Serper (Google Search) API for the top 3 organic product URLs.
 * Requires SERPER_API_KEY in environment variables.
 *
 * Body: { product: { name: string, brand: string } }
 * Returns: { success: true, urls: string[] }
 */
export async function POST(req: Request) {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const { product } = await req.json();
    if (!product?.name || !product?.brand) {
      return NextResponse.json(
        { error: 'product.name and product.brand are required.' },
        { status: 400 },
      );
    }

    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'SERPER_API_KEY not configured.' }, { status: 500 });
    }

    const query = `${product.name} ${product.brand}`;

    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify({ q: query, gl: 'au' }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Serper API error: ${res.status}`, detail: text.slice(0, 300) },
        { status: 500 },
      );
    }

    const data = await res.json();
    const urls: string[] = (data.organic ?? [])
      .map((r: any) => r.link as string)
      .filter(Boolean)
      .slice(0, 3);

    return NextResponse.json({ success: true, urls, query });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unexpected error' }, { status: 500 });
  }
}
