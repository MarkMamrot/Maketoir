import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * POST /api/website/serper-search
 *
 * Queries the Serper (Google Search) API for the top 3 organic product URLs.
 * Optionally accepts preferred_sites (array of URLs/domains) — runs site-specific
 * searches first so those domains are prioritised in the 3-URL result set.
 *
 * Body: { product: { name: string, brand: string }, preferred_sites?: string[] }
 * Returns: { success: true, urls: string[] }
 */

async function serperQuery(query: string, apiKey: string): Promise<string[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, gl: 'au' }),
    signal: AbortSignal.timeout(12000),
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

export async function POST(req: Request) {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const body = await req.json();
    const { product, preferred_sites = [] } = body;
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

    // Extract unique domains from preferred_sites (max 2)
    const preferredDomains = [...new Set(
      (preferred_sites as string[]).map(extractDomain).filter(Boolean) as string[]
    )].slice(0, 2);

    // Run all searches in parallel: one per preferred domain + one general
    const searches: Promise<string[]>[] = [
      ...preferredDomains.map(domain => serperQuery(`${baseQuery} site:${domain}`, apiKey)),
      serperQuery(baseQuery, apiKey),
    ];
    const results = await Promise.allSettled(searches);

    // Merge: up to 1 result per preferred domain first, then fill from general search
    const seen = new Set<string>();
    const urls: string[] = [];

    // First: take the best result from each domain-specific search
    for (let i = 0; i < preferredDomains.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        for (const url of r.value) {
          if (!seen.has(url)) { seen.add(url); urls.push(url); break; }
        }
      }
    }

    // Then: fill remaining slots from the general search
    const generalIdx = preferredDomains.length;
    const generalResult = results[generalIdx];
    if (generalResult?.status === 'fulfilled') {
      for (const url of generalResult.value) {
        if (urls.length >= 3) break;
        if (!seen.has(url)) { seen.add(url); urls.push(url); }
      }
    }

    return NextResponse.json({ success: true, urls: urls.slice(0, 3), query: baseQuery });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unexpected error' }, { status: 500 });
  }
}
