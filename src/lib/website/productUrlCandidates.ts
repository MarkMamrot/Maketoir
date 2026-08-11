export interface ProductUrlIdentity {
  name: string;
  brand?: string;
  code?: string;
  barcode?: string;
}

const GENERIC_WORDS = new Set(['and', 'the', 'for', 'with', 'from', 'new', 'hat', 'hats', 'cap', 'caps']);
const NON_PRODUCT_PATH = /\/(?:collections?|categories?|search|pages?|blogs?|brands?)(?:\/|$)/i;
const PRODUCT_PATH = /\/(?:products?|product|p)\//i;
const TRACKING_QUERY_KEYS = new Set(['srsltid', 'gclid', 'fbclid', '_gl']);
const NON_RETAIL_HOSTS = /(^|\.)(?:instagram\.com|facebook\.com|fb\.com|pinterest\.[a-z.]+|tiktok\.com|youtube\.com|youtu\.be|x\.com|twitter\.com)$/i;

function isRetailCandidateUrl(url: URL): boolean {
  return /^https?:$/.test(url.protocol) && !NON_RETAIL_HOSTS.test(url.hostname.replace(/^www\./, ''));
}

function safeDecodeURIComponent(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function canonicalProductCandidateUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!isRetailCandidateUrl(url)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_') || TRACKING_QUERY_KEYS.has(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

function normalizedWords(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function identityWords(product: ProductUrlIdentity): string[] {
  const brandWords = new Set(normalizedWords(product.brand ?? ''));
  return [...new Set(normalizedWords(product.name).filter(word => word.length >= 3 && !brandWords.has(word) && !GENERIC_WORDS.has(word)))];
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function productUrlScore(url: string, label: string, product: ProductUrlIdentity): number {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return -100; }
  if (!isRetailCandidateUrl(parsed) || NON_PRODUCT_PATH.test(parsed.pathname)) return -100;

  const haystack = safeDecodeURIComponent(`${parsed.pathname} ${label}`).toLowerCase();
  let score = PRODUCT_PATH.test(parsed.pathname) ? 8 : 0;
  for (const word of identityWords(product)) {
    if (haystack.includes(word)) score += 3;
  }
  for (const identifier of [product.code, product.barcode]) {
    const value = compact(identifier ?? '');
    if (value.length >= 4 && compact(haystack).includes(value)) score += 20;
  }
  return score;
}

export function isLikelyProductUrl(url: string, product: ProductUrlIdentity, label = ''): boolean {
  const words = identityWords(product);
  const minimum = words.length > 0 ? 11 : 8;
  return productUrlScore(url, label, product) >= minimum;
}

export function isProductPageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return isRetailCandidateUrl(parsed) && PRODUCT_PATH.test(parsed.pathname) && !NON_PRODUCT_PATH.test(parsed.pathname);
  } catch {
    return false;
  }
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}

export function extractLinkedProductUrls(html: string, pageUrl: string, product: ProductUrlIdentity, limit = 5): string[] {
  let page: URL;
  try { page = new URL(pageUrl); } catch { return []; }
  const candidates = new Map<string, number>();

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(decodeHtml(match[1]), page);
      if (url.hostname !== page.hostname) continue;
      const label = decodeHtml(match[2].replace(/<[^>]+>/g, ' '));
      const canonicalUrl = canonicalProductCandidateUrl(url.href);
      if (!canonicalUrl) continue;
      const score = productUrlScore(canonicalUrl, label, product);
      if (score < 11) continue;
      candidates.set(canonicalUrl, Math.max(score, candidates.get(canonicalUrl) ?? -100));
    } catch {
      // Ignore malformed links.
    }
  }

  return [...candidates.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([url]) => url);
}