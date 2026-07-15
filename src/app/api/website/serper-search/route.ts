import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * POST /api/website/serper-search
 *
 * Single Serper (Google Search) query — fetches the top 20 organic results,
 * then reorders them so any preferred-domain URLs appear first (one per domain),
 * followed by the remaining general results to fill up to 3.
 *
 * Body: {
 *   product: { name: string, brand: string }
 *   preferred_sites?: string[]   // full URLs or domains to prioritise (only enabled ones)
 *   excluded_sites?:  string[]   // full URLs or domains to exclude entirely (unchecked sources)
 *   include_general?: boolean    // default true — include non-preferred results
 * }
 * Returns: { success: true, urls: string[] }
 */

async function serperQuery(query: string, apiKey: string, num = 20): Promise<string[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify(search_au_only ? { q: query, gl: 'au', num } : { q: query, num }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.organic ?? []).map((r: any) => r.link as string).filter(Boolean);
}

function extractDomain(url: string): string | null {
  try {
    const href = url.startsWith('http') ? url : `https://${url}`;
    return new URL(href).hostname.replace(/^www\./, '');
  } catch { return null; }
}

function urlMatchesDomain(url: string, domain: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return h === domain || h.endsWith(`.${domain}`);
  } catch { return false; }
}

export async function POST(req: Request) {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const body = await req.json();
    const { product, preferred_sites = [], excluded_sites = [], include_general = true, search_au_only = true } = body;
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

    const baseQuery = `${product.name} ${product.brand}`;

    // Extract unique preferred domains (only from explicitly-enabled URLs, max 2)
    const preferredDomains = [...new Set(
      (preferred_sites as string[]).map(extractDomain).filter(Boolean) as string[]
    )].slice(0, 2);

    // Domains that are explicitly excluded (unchecked sources — never appear in results)
    const excludedDomains = [...new Set(
      (excluded_sites as string[]).map(extractDomain).filter(Boolean) as string[]
    )];

    // Single search — pull top 20 results as the pool to reorder from
    const rawUrls = await serperQuery(baseQuery, apiKey, 20);

    // Strip any URL whose domain is in the excluded list
    const allUrls = excludedDomains.length
      ? rawUrls.filter(url => !excludedDomains.some(d => urlMatchesDomain(url, d)))
      : rawUrls;

    const seen = new Set<string>();
    const urls: string[] = [];

    // First: pick the first result in the pool that matches each preferred domain
    for (const domain of preferredDomains) {
      const match = allUrls.find(url => urlMatchesDomain(url, domain) && !seen.has(url));
      if (match) { seen.add(match); urls.push(match); }
    }

    // Then: fill remaining slots from the general pool (skip already-chosen)
    if (include_general) {
      for (const url of allUrls) {
        if (urls.length >= 3) break;
        if (!seen.has(url)) { seen.add(url); urls.push(url); }
      }
    }

    return NextResponse.json({ success: true, urls: urls.slice(0, 3), query: baseQuery });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unexpected error' }, { status: 500 });
  }
}

