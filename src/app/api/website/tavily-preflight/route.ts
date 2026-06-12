import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * POST /api/website/tavily-preflight
 *
 * Step 1 of the "Generate Content" workflow.
 * Calls Tavily Search with search_depth=advanced and include_answer=true
 * to return:
 *   - answer: synthesised product research text
 *   - urls:   top 3 product page URLs
 */
export async function POST(req: Request) {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const body = await req.json();
    const { product, firstUrl, photosOnly } = body;

    if (!product?.name || !product?.brand) {
      return NextResponse.json({ error: 'product.name and product.brand are required.' }, { status: 400 });
    }

    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'TAVILY_API_KEY not configured.' }, { status: 500 });
    }

    // Build query: if photosOnly mode (auto-retrieve Step 2), just extract images from the URL.
    // If a specific URL was found by serper, direct Tavily to summarise it;
    // otherwise fall back to the original name/barcode discovery query.
    let query: string;
    if (photosOnly && firstUrl) {
      // Skip text summary — only need images from this URL
      query = `${product.name} ${product.brand} product images`;
    } else if (firstUrl) {
      query = `Search ${firstUrl} and give a summary of product information.`;
    } else {
      const barcodeHint = product.barcode ? ` May have barcode ${product.barcode} and code ${product.code}.` : (product.code ? ` May have code ${product.code}.` : '');
      query = `Find the product URL of ${product.name} by the brand ${product.brand}.${barcodeHint} Also get a detailed description of the product. Preferably pull from the official ${product.brand} website. Make the URLS you pull be from different domains.`;
    }

    const searchRequest: Record<string, any> = {
      query,
      search_depth: photosOnly ? 'basic' : 'advanced',
      max_results: photosOnly ? 1 : 3,
      include_answer: photosOnly ? false : 'advanced',
      include_images: true,
    };

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(searchRequest),
      signal: AbortSignal.timeout(30000),
    });

    const rawText = await res.text();

    if (!res.ok) {
      return NextResponse.json(
        { error: `Tavily API error: ${res.status}`, detail: rawText.slice(0, 500) },
        { status: 500 },
      );
    }

    let json: any;
    try {
      json = JSON.parse(rawText);
    } catch {
      return NextResponse.json(
        { error: 'Failed to parse Tavily response', detail: rawText.slice(0, 500) },
        { status: 500 },
      );
    }

    const answer: string = json.answer ?? '';
    const urls: string[] = (json.results ?? [])
      .map((r: any) => r.url ?? '')
      .filter(Boolean)
      .slice(0, 3);

    // --- Also extract images via Tavily Extract on the result URLs ---
    const IMAGE_NOISE = ['thumb', 'icon', 'swatch', 'logo', 'favicon', 'width=160', 'width=100', 'width=50'];
    const isUsable = (u: string) => !IMAGE_NOISE.some(n => u.includes(n));
    const imageSet = new Set<string>();

    // Images from the search response itself
    for (const img of (json.images ?? [])) {
      if (typeof img === 'string' && isUsable(img)) imageSet.add(img);
    }

    // Images from Tavily Extract (handles Cloudflare-protected pages)
    if (urls.length > 0) {
      try {
        const extractRes = await fetch('https://api.tavily.com/extract', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ urls, include_images: true }),
          signal: AbortSignal.timeout(30000),
        });
        if (extractRes.ok) {
          const extractJson = await extractRes.json();
          for (const result of (extractJson.results ?? [])) {
            for (const img of (result.images ?? [])) {
              if (typeof img === 'string' && isUsable(img)) imageSet.add(img);
            }
          }
        }
      } catch (e: any) {
        console.warn('[tavily-preflight] Extract error:', e.message);
      }
    }

    const images = [...imageSet].slice(0, 6);

    return NextResponse.json({ answer, urls, images, query,
      tavilyRequest: searchRequest,
      tavilyResponse: json,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unexpected error' }, { status: 500 });
  }
}
