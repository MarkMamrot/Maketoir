const IMAGE_EXTENSION = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;
const IMAGE_NOISE = /(?:favicon|icon|logo|placeholder|spinner|swatch|thumbnail|thumb)(?:[._/?-]|$)/i;

function normalizeImageUrl(rawUrl: string, pageUrl: string): string | null {
  const decoded = rawUrl
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/\\+$/g, '')
    .trim();

  try {
    const url = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded, pageUrl);
    if (!/^https?:$/.test(url.protocol) || !IMAGE_EXTENSION.test(url.href) || IMAGE_NOISE.test(url.href)) return null;
    if (url.protocol === 'http:') url.protocol = 'https:';
    url.searchParams.delete('width');
    url.searchParams.delete('height');
    return url.href;
  } catch {
    return null;
  }
}

function collectImageValues(value: unknown, target: string[], pageUrl: string) {
  if (typeof value === 'string') {
    const normalized = normalizeImageUrl(value, pageUrl);
    if (normalized) target.push(normalized);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectImageValues(item, target, pageUrl));
    return;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    collectImageValues(record.url ?? record.contentUrl, target, pageUrl);
  }
}

function collectProductImages(value: unknown, target: string[], pageUrl: string) {
  if (Array.isArray(value)) {
    value.forEach(item => collectProductImages(item, target, pageUrl));
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
  if (types.some(type => type === 'Product' || type === 'ProductGroup')) {
    collectImageValues(record.image, target, pageUrl);
    if (Array.isArray(record.hasVariant)) {
      record.hasVariant.forEach(variant => {
        if (variant && typeof variant === 'object') {
          collectImageValues((variant as Record<string, unknown>).image, target, pageUrl);
        }
      });
    }
  }

  if (record['@graph']) collectProductImages(record['@graph'], target, pageUrl);
}

function assetFamilyToken(imageUrl: string): string | null {
  try {
    const filename = decodeURIComponent(new URL(imageUrl).pathname.split('/').pop() ?? '');
    const tokens = filename.replace(/\.[^.]+$/, '').split(/[_\-.\s]+/).filter(Boolean);
    return tokens.find(token => /\d/.test(token) && token.length >= 6)?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function rawImageUrls(html: string, pageUrl: string): string[] {
  const matches = html.match(/(?:https?:)?(?:\\?\/){2}[^"'\s<>]+?\.(?:avif|gif|jpe?g|png|webp)(?:\?[^"'\s<>]*)?/gi) ?? [];
  return matches
    .map(url => normalizeImageUrl(url, pageUrl))
    .filter((url): url is string => Boolean(url));
}

function dedupeImageVariants(urls: string[]): string[] {
  const unique = new Map<string, string>();
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      const canonicalPath = decodeURIComponent(parsed.pathname)
        .replace(/_(?:grande|large|medium|small)(?=\.[^.]+$)/i, '')
        .toLowerCase();
      const key = `${parsed.hostname.toLowerCase()}${canonicalPath}`;
      if (!unique.has(key)) unique.set(key, url);
    } catch {
      if (!unique.has(url)) unique.set(url, url);
    }
  }
  return [...unique.values()];
}

export function extractProductPageImages(html: string, pageUrl: string, limit = 10): string[] {
  const structuredImages: string[] = [];
  const scriptPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    try {
      collectProductImages(JSON.parse(match[1]), structuredImages, pageUrl);
    } catch {
      // Ignore malformed third-party structured data blocks.
    }
  }

  const metaImagePattern = /<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["'][^>]*>|<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image(?::src)?)["'][^>]*>/gi;
  for (const match of html.matchAll(metaImagePattern)) {
    const normalized = normalizeImageUrl(match[1] ?? match[2], pageUrl);
    if (normalized) structuredImages.push(normalized);
  }

  const uniqueStructured = dedupeImageVariants(structuredImages);
  const familyTokens = [...new Set(uniqueStructured.map(assetFamilyToken).filter((token): token is string => Boolean(token)))];
  if (familyTokens.length === 0) return uniqueStructured.slice(0, limit);

  const familyImages = rawImageUrls(html, pageUrl).filter(imageUrl => {
    const lowerUrl = decodeURIComponent(imageUrl).toLowerCase();
    return familyTokens.some(token => lowerUrl.includes(token));
  });

  return dedupeImageVariants([...uniqueStructured, ...familyImages]).slice(0, limit);
}