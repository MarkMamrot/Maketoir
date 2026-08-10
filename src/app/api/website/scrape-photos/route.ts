import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { extractIdentityVerifiedShopifyImages, extractProductPageImageCandidates, extractShopifyProductImages, normalizeProductImageCandidate, type ProductImageIdentity } from '@/lib/website/productPageImages';
import { extractIndexedProductPageFacts, extractProductPageFacts, extractShopifyProductFacts, type IndexedProductPageRecord } from '@/lib/website/productPageFacts';
import { productSearchQueries } from '@/lib/website/productResearchRules';
import { readSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function canonicalProductUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('utm_') || ['srsltid', 'gclid', 'fbclid', '_gl'].includes(key)) {
      url.searchParams.delete(key);
    }
  }
  return url.href;
}

async function fetchProductPage(rawUrl: string): Promise<Response> {
  const canonicalUrl = canonicalProductUrl(rawUrl);
  const attempts = canonicalUrl === rawUrl ? [canonicalUrl, canonicalUrl] : [canonicalUrl, rawUrl];
  let lastError: unknown;

  for (const attemptUrl of attempts) {
    try {
      const response = await fetch(attemptUrl, {
        headers: PAGE_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Product page fetch failed');
}

async function fetchShopifyProduct(rawUrl: string): Promise<{ images: string[]; facts: string }> {
  const url = new URL(canonicalProductUrl(rawUrl));
  if (!/^\/products\/[^/]+\/?$/.test(url.pathname)) return { images: [], facts: '' };
  url.pathname = `${url.pathname.replace(/\/$/, '')}.js`;

  try {
    const response = await fetch(url, {
      headers: PAGE_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return { images: [], facts: '' };
    const payload = await response.json();
    const sourceUrl = response.url || url.href;
    return {
      images: extractShopifyProductImages(payload, sourceUrl),
      facts: extractShopifyProductFacts(payload, sourceUrl),
    };
  } catch (error) {
    console.warn(`[scrape-photos] Shopify product JSON failed for ${rawUrl}:`, error instanceof Error ? error.message : error);
    return { images: [], facts: '' };
  }
}

async function fetchIndexedProductFacts(rawUrl: string, apiKey: string): Promise<string> {
  const canonicalUrl = canonicalProductUrl(rawUrl);
  const queries = [canonicalUrl, `${canonicalUrl} dimensions`, `${canonicalUrl} "Product Details"`];
  const records: IndexedProductPageRecord[] = [];

  for (const query of queries) {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({ q: query, gl: 'au', num: 10 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Serper HTTP ${response.status}`);
    const data = await response.json();
    records.push(...(Array.isArray(data.organic) ? data.organic : []));
  }

  return extractIndexedProductPageFacts(records, canonicalUrl);
}

async function fetchIdentityVerifiedImages(
  product: { name: string; brand?: string; sku?: string; code?: string; barcode?: string },
  sourceSites: string[],
  apiKey?: string,
): Promise<string[]> {
  const identity: ProductImageIdentity = {
    sku: product.sku ?? product.code ?? '',
    barcode: product.barcode ?? '',
  };
  const identifiers = [identity.sku, identity.barcode].map(value => String(value ?? '').trim()).filter(Boolean);
  const sourceDomains = [...new Set(sourceSites.flatMap(site => {
    try {
      const url = new URL(site.startsWith('http') ? site : `https://${site}`);
      return [url.hostname.replace(/^www\./, '')];
    } catch {
      return [];
    }
  }))].slice(0, 3);

  for (const domain of sourceDomains) {
    for (let page = 1; page <= 4; page += 1) {
      try {
        const catalogUrl = `https://${domain}/products.json?limit=250&page=${page}`;
        const response = await fetch(catalogUrl, {
          headers: PAGE_HEADERS,
          redirect: 'follow',
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) break;
        const payload = await response.json();
        const products = Array.isArray(payload?.products) ? payload.products : [];
        for (const catalogProduct of products) {
          const images = extractIdentityVerifiedShopifyImages(catalogProduct, response.url || catalogUrl, identity);
          if (images.length > 0) return images;
        }
        if (products.length < 250) break;
      } catch {
        break;
      }
    }
  }

  if (!apiKey) return [];
  const sourceQueries = sourceDomains.flatMap(domain => identifiers.map(identifier => `site:${domain} ${identifier}`));
  const generalQueries = [
    ...productSearchQueries(product.name, product.brand ?? '', identity.sku ?? '', identity.barcode ?? '').slice(1),
    ...identifiers,
  ];
  const queries = [...new Set([...sourceQueries, ...generalQueries])];
  if (queries.length === 0) return [];

  const searchResults = await Promise.allSettled(queries.map(async query => {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({ q: query, gl: 'au', num: 10 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Serper HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data.organic) ? data.organic.map((record: any) => String(record.link ?? '')).filter(Boolean) : [];
  }));

  const candidates = [...new Set(searchResults.flatMap(result => result.status === 'fulfilled' ? result.value : []))].filter(candidate => {
    try { return /^\/products\/[^/]+\/?$/.test(new URL(candidate).pathname); } catch { return false; }
  }).slice(0, 30);

  for (const candidate of candidates) {
    const productUrl = new URL(canonicalProductUrl(candidate));
    productUrl.pathname = `${productUrl.pathname.replace(/\/$/, '')}.js`;
    try {
      const response = await fetch(productUrl, {
        headers: PAGE_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const images = extractIdentityVerifiedShopifyImages(payload, response.url || productUrl.href, identity);
      if (images.length > 0) return images;
    } catch {
      // Continue to the next exact-identifier search result.
    }
  }
  return [];
}

/**
 * POST /api/website/scrape-photos
 *
 * Scrapes up to 10 product images from the provided URLs.
 * Uses Tavily Extract API first (bypasses Cloudflare / bot protection),
 * then falls back to a direct fetch for any URLs Tavily cannot handle.
 * Returns trusted gallery images separately from review-only fallback candidates.
 */
export async function POST(req: Request) {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const body = await req.json();
    const urls: string[] = (body.urls ?? []).filter((u: any) => typeof u === 'string' && u.startsWith('http'));
    const includeFallback = body.includeFallback === true;
    const product = body.product && typeof body.product === 'object' ? body.product : null;
    const sourceSites: string[] = (body.source_sites ?? []).filter((site: unknown) => typeof site === 'string' && site.trim());

    if (urls.length === 0) {
      return NextResponse.json({ images: [], fallbackImages: [], productFacts: '' });
    }

    const uniqueImages = new Set<string>();
    const fallbackImages = new Set<string>();
    const productFactBlocks: string[] = [];
    const failedUrls: string[] = [];

    // Prefer the approved page's own product gallery. This excludes recommendation
    // carousels and other products that broad image extraction commonly returns.
    for (const rawUrl of urls) {
      const shopifyProductPromise = fetchShopifyProduct(rawUrl);
      let directImages: string[] = [];
      let directFacts = '';
      try {
        const pageRes = await fetchProductPage(rawUrl);
        const html = await pageRes.text();
        const sourceUrl = pageRes.url || canonicalProductUrl(rawUrl);
        const candidates = extractProductPageImageCandidates(html, sourceUrl);
        const images = candidates.images;
        const facts = extractProductPageFacts(html, sourceUrl);
        directFacts = facts;
        if (directFacts) productFactBlocks.push(directFacts);
        directImages = images;
        candidates.fallbackImages.forEach(image => fallbackImages.add(image));
      } catch (e: any) {
        console.warn(`[scrape-photos] Direct fetch failed for ${rawUrl}:`, e.message);
      }

      const shopifyProduct = await shopifyProductPromise;
      const shopifyImages = shopifyProduct.images;
      if (!directFacts && shopifyProduct.facts) productFactBlocks.push(shopifyProduct.facts);
      const trustedImages = directImages.length > 1 || directImages.length >= shopifyImages.length
        ? directImages
        : shopifyImages;
      trustedImages.forEach(image => uniqueImages.add(image));
      if (trustedImages.length === 0) {
        failedUrls.push(rawUrl);
      }
    }

    // Tavily is a fallback for pages the direct structured-gallery pass cannot read.
    const tavilyKey = process.env.TAVILY_API_KEY;
    const tavilyUrls = includeFallback ? urls : failedUrls;
    if (tavilyKey && tavilyUrls.length > 0) {
      try {
        const tavilyRes = await fetch('https://api.tavily.com/extract', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tavilyKey}`,
          },
          body: JSON.stringify({ urls: tavilyUrls, include_images: true }),
          signal: AbortSignal.timeout(30000),
        });

        if (tavilyRes.ok) {
          const tavilyJson = await tavilyRes.json();
          const results: any[] = tavilyJson.results ?? [];
          const failed: any[] = tavilyJson.failed_results ?? [];

          // Broad Tavily image lists include recommendations and page chrome.
          // Only page content with structured product evidence is trusted.
          for (const result of results) {
            if (result.raw_content && result.url) {
              const candidates = extractProductPageImageCandidates(result.raw_content, result.url);
              candidates.images.forEach(image => uniqueImages.add(image));
              candidates.fallbackImages.forEach(image => fallbackImages.add(image));
              const facts = extractProductPageFacts(result.raw_content, result.url);
              if (facts) productFactBlocks.push(facts);
            }
            if (includeFallback && result.url) {
              for (const image of (result.images ?? [])) {
                if (typeof image !== 'string') continue;
                const normalized = normalizeProductImageCandidate(image, result.url);
                if (normalized) fallbackImages.add(normalized);
              }
            }
          }

          // Queue any URLs Tavily couldn't fetch for direct fallback
          for (const f of failed) console.warn(`[scrape-photos] Tavily could not extract ${f.url ?? 'page'}`);
        }
      } catch (e: any) {
        console.warn('[scrape-photos] Tavily Extract error:', e.message);
      }
    }

    // Some approved commerce pages block both direct requests and Tavily. In
    // that case, use only Google records whose URL exactly matches the approved
    // page; related search results remain excluded.
    if (productFactBlocks.length === 0 && urls.length === 1 && process.env.SERPER_API_KEY) {
      try {
        const indexedFacts = await fetchIndexedProductFacts(urls[0], process.env.SERPER_API_KEY);
        if (indexedFacts) productFactBlocks.push(indexedFacts);
      } catch (error) {
        const runtimeSession = readSession();
        await reportRuntimeIssue({
          businessId: runtimeSession?.businessId,
          source: 'website-content',
          operation: 'extract_indexed_product_facts',
          severity: 'warning',
          title: 'Approved product page indexed-text fallback failed',
          error: error instanceof Error ? error : new Error(String(error)),
          context: { approvedUrl: canonicalProductUrl(urls[0]).slice(0, 500) },
        });
      }
    }

    // When the approved page blocks gallery extraction, search for another
    // structured listing and accept its gallery only after exact variant-level
    // SKU/barcode verification. Domain, supplier, and product names are not
    // hard-coded, and sibling variants are rejected.
    if (uniqueImages.size === 0 && product?.name && (sourceSites.length > 0 || process.env.SERPER_API_KEY)) {
      try {
        const verifiedImages = await fetchIdentityVerifiedImages(product, sourceSites, process.env.SERPER_API_KEY);
        verifiedImages.forEach(image => uniqueImages.add(image));
      } catch (error) {
        const runtimeSession = readSession();
        await reportRuntimeIssue({
          businessId: runtimeSession?.businessId,
          source: 'website-content',
          operation: 'extract_identity_verified_product_images',
          severity: 'warning',
          title: 'Exact-identity product image fallback failed',
          error: error instanceof Error ? error : new Error(String(error)),
          context: { productName: String(product.name).slice(0, 200) },
        });
      }
    }

    return NextResponse.json({
      images: [...uniqueImages].slice(0, 10),
      fallbackImages: [...fallbackImages].filter(image => !uniqueImages.has(image)).slice(0, 30),
      productFacts: [...new Set(productFactBlocks)].join('\n\n').slice(0, 16_000),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unexpected error' }, { status: 500 });
  }
}
