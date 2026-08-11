import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { canonicalProductCandidateUrl, extractLinkedProductUrls, isLikelyProductUrl, isProductPageUrl, productUrlScore, type ProductUrlIdentity } from '@/lib/website/productUrlCandidates';
import { productSearchQueries } from '@/lib/website/productResearchRules';
import { readSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

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
 * Returns: { success: true, urls: string[], candidates: { url, evidence }[] }
 */

interface SerperOrganicResult {
  url: string;
  label: string;
}

interface SerperQueryResult {
  results: SerperOrganicResult[];
  error?: string;
}

async function serperQuery(query: string, apiKey: string, num = 20, searchAuOnly = true): Promise<SerperQueryResult> {
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify(searchAuOnly ? { q: query, gl: 'au', num } : { q: query, num }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { results: [], error: `Serper HTTP ${res.status}` };
    const data = await res.json();
    return {
      results: (data.organic ?? [])
        .filter((result: any) => result?.link)
        .map((result: any) => ({
          url: String(result.link),
          label: `${String(result.title ?? '')} ${String(result.snippet ?? '')}`.trim(),
        })),
    };
  } catch (error) {
    return { results: [], error: error instanceof Error ? error.message : 'Serper request failed' };
  }
}

function mergeSearchResults(searches: SerperQueryResult[]): SerperOrganicResult[] {
  const results = new Map<string, string>();
  for (const result of searches.flatMap(search => search.results)) {
    const url = canonicalProductCandidateUrl(result.url);
    if (!url) continue;
    const existingLabel = results.get(url) ?? '';
    results.set(url, `${existingLabel} ${result.label}`.trim());
  }
  return [...results].map(([url, label]) => ({ url, label }));
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

async function expandPreferredResults(urls: string[], domain: string, product: ProductUrlIdentity): Promise<string[]> {
  const pages = urls.filter(url => urlMatchesDomain(url, domain) && !isLikelyProductUrl(url, product)).slice(0, 3);
  const expanded = await Promise.all(pages.map(async pageUrl => {
    try {
      const response = await fetch(pageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketoirProductDiscovery/1.0)', 'Accept': 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return [];
      return extractLinkedProductUrls(await response.text(), response.url || pageUrl, product);
    } catch {
      return [];
    }
  }));
  return [...new Set(expanded.flat())];
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

    const identity: ProductUrlIdentity = {
      name: String(product.name),
      brand: String(product.brand ?? ''),
      code: String(product.sku ?? product.code ?? ''),
      barcode: String(product.barcode ?? ''),
    };
    const searchQueries = productSearchQueries(identity.name, identity.brand ?? '', identity.code, identity.barcode);
    const baseQuery = searchQueries[0];

    // Extract unique preferred domains (only from explicitly-enabled URLs, max 2)
    const preferredDomains = [...new Set(
      (preferred_sites as string[]).map(extractDomain).filter(Boolean) as string[]
    )].slice(0, 2);

    // Domains that are explicitly excluded (unchecked sources — never appear in results)
    const excludedDomains = [...new Set(
      (excluded_sites as string[]).map(extractDomain).filter(Boolean) as string[]
    )];

    const searchResults = await Promise.all([
      include_general
        ? Promise.all(searchQueries.map(query => serperQuery(query, apiKey, 20, search_au_only)))
        : Promise.resolve([]),
      ...preferredDomains.map(domain => serperQuery(`site:${domain} ${baseQuery}`, apiKey, 8, search_au_only)),
    ]);
    const generalSearches = searchResults[0] as SerperQueryResult[];
    const preferredSearches = searchResults.slice(1) as SerperQueryResult[];
    const rawResults = mergeSearchResults(generalSearches);
    const preferredResults = preferredSearches.map(search => mergeSearchResults([search]));
    const searchErrors = [...generalSearches, ...preferredSearches].flatMap(result => result.error ? [result.error] : []);
    if (searchErrors.length > 0) {
      const runtimeSession = readSession();
      await reportRuntimeIssue({
        businessId: runtimeSession?.businessId,
        source: 'website-content',
        operation: 'serper_product_search',
        severity: 'warning',
        title: 'Product URL search provider request failed',
        error: new Error(searchErrors.join('; ')),
        context: {
          productName: identity.name.slice(0, 200),
          preferredDomainCount: preferredDomains.length,
          failedRequestCount: searchErrors.length,
          includeGeneral: Boolean(include_general),
        },
      });
    }

    // Strip any URL whose domain is in the excluded list
    const allResults = excludedDomains.length
      ? rawResults.filter(result => !excludedDomains.some(domain => urlMatchesDomain(result.url, domain)))
      : rawResults;

    const seen = new Set<string>();
    const urls: string[] = [];

    // First: use one strong product URL per enabled supplier/brand domain. If
    // Google only found a category page, inspect that page for the product link.
    for (const [index, domain] of preferredDomains.entries()) {
      const preferredPool = preferredResults[index] ?? [];
      const domainPool = [...preferredPool, ...allResults.filter(result => urlMatchesDomain(result.url, domain))];
      const directMatches = domainPool
        .filter(result => !seen.has(result.url) && isLikelyProductUrl(result.url, identity, result.label))
        .sort((a, b) => productUrlScore(b.url, b.label, identity) - productUrlScore(a.url, a.label, identity));
      const expandedMatches = directMatches.length > 0 ? [] : await expandPreferredResults(domainPool.map(result => result.url), domain, identity);
      const match = directMatches[0]?.url ?? expandedMatches[0];
      if (match) { seen.add(match); urls.push(match); }
    }

    // Then fill from general web, preferring other domains so supplier results
    // cannot crowd out viable retailer/product pages.
    if (include_general) {
      const strictGeneralCandidates = allResults
        .filter(result => !seen.has(result.url) && isLikelyProductUrl(result.url, identity, result.label))
        .sort((a, b) => {
          const aPreferred = preferredDomains.some(domain => urlMatchesDomain(a.url, domain)) ? 1 : 0;
          const bPreferred = preferredDomains.some(domain => urlMatchesDomain(b.url, domain)) ? 1 : 0;
          return aPreferred - bPreferred || productUrlScore(b.url, b.label, identity) - productUrlScore(a.url, a.label, identity);
        });
      const strictUrls = new Set(strictGeneralCandidates.map(result => result.url));
      const fallbackProductPages = allResults.filter(result =>
        !seen.has(result.url) && !strictUrls.has(result.url) && isProductPageUrl(result.url)
      );
      const generalCandidates = [...strictGeneralCandidates, ...fallbackProductPages];
      for (const { url } of generalCandidates) {
        if (urls.length >= 5) break;
        if (!seen.has(url)) { seen.add(url); urls.push(url); }
      }
    }

    const selectedUrls = urls.slice(0, 5);
    const mergedSearchResults = mergeSearchResults([...generalSearches, ...preferredSearches]);
    const evidenceByUrl = new Map(mergedSearchResults.map(result => [result.url, result.label] as const));
    const candidates = selectedUrls.map(url => ({
      url,
      evidence: String(evidenceByUrl.get(url) ?? '').slice(0, 1200),
    }));
    const selectedSet = new Set(selectedUrls);
    const rejected = allResults
      .filter(result => !selectedSet.has(result.url))
      .sort((a, b) => productUrlScore(b.url, b.label, identity) - productUrlScore(a.url, a.label, identity))
      .slice(0, 10)
      .map(result => ({
        url: result.url,
        reason: isProductPageUrl(result.url)
          ? 'Lower relevance to this exact product.'
          : 'Not recognised as an exact product page.',
      }));
    const providerResultCount = [...generalSearches, ...preferredSearches]
      .reduce((count, search) => count + search.results.length, 0);
    const discovery = {
      providerResultCount,
      uniqueRetailResultCount: mergedSearchResults.length,
      candidateCount: selectedUrls.length,
      filteredCount: Math.max(0, providerResultCount - selectedUrls.length),
      rejected,
    };

    return NextResponse.json({ success: true, urls: selectedUrls, candidates, discovery, query: baseQuery, queries: searchQueries });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unexpected error' }, { status: 500 });
  }
}

