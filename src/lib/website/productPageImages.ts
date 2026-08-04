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

function imageUrlsFromMarkup(markup: string, pageUrl: string): string[] {
  const images: string[] = [];
  for (const match of markup.matchAll(/\b(?:href|src|data-src)=["']([^"']+)["']/gi)) {
    const normalized = normalizeImageUrl(match[1], pageUrl);
    if (normalized) images.push(normalized);
  }
  for (const match of markup.matchAll(/\b(?:srcset|data-srcset)=["']([^"']+)["']/gi)) {
    for (const candidate of match[1].split(',')) {
      const normalized = normalizeImageUrl(candidate.trim().split(/\s+/)[0], pageUrl);
      if (normalized) images.push(normalized);
    }
  }
  return images;
}

function scopedProductMediaImages(html: string, pageUrl: string): string[] {
  const images: string[] = [];
  const containerPatterns = [
    /<li\b[^>]*class=["'][^"']*product__media-item[^"']*["'][^>]*>[\s\S]*?<\/li>/gi,
    /<(?:figure|div)\b[^>]*class=["'][^"']*(?:product-media-wrapper|product__media-item)[^"']*["'][^>]*>[\s\S]{0,20000}?<\/(?:figure|div)>/gi,
  ];
  for (const pattern of containerPatterns) {
    for (const match of html.matchAll(pattern)) images.push(...imageUrlsFromMarkup(match[0], pageUrl));
  }
  return images;
}

function explicitGalleryImages(html: string, pageUrl: string): string[] {
  const images: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/(?:class=["'][^"']*(?:show-gallery|product[^"']*gallery)[^"']*["']|aria-label=["'][^"']*(?:gallery|open media)[^"']*["'])/i.test(tag)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const normalized = normalizeImageUrl(href, pageUrl);
    if (normalized) images.push(normalized);
  }
  return images;
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

export interface ProductPageImageCandidates {
  images: string[];
  fallbackImages: string[];
}

export function extractProductPageImageCandidates(html: string, pageUrl: string, limit = 10): ProductPageImageCandidates {
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
  const galleryImages = dedupeImageVariants(explicitGalleryImages(html, pageUrl));
  const scopedMediaImages = dedupeImageVariants(scopedProductMediaImages(html, pageUrl));
  let trustedImages: string[];
  if (galleryImages.length > 1 || scopedMediaImages.length > 1) {
    trustedImages = dedupeImageVariants([...uniqueStructured, ...galleryImages, ...scopedMediaImages]);
  } else {
    const familyTokens = [...new Set(uniqueStructured.map(assetFamilyToken).filter((token): token is string => Boolean(token)))];
    const familyImages = familyTokens.length === 0
      ? []
      : rawImageUrls(html, pageUrl).filter(imageUrl => {
          const lowerUrl = decodeURIComponent(imageUrl).toLowerCase();
          return familyTokens.some(token => lowerUrl.includes(token));
        });
    trustedImages = dedupeImageVariants([...uniqueStructured, ...galleryImages, ...scopedMediaImages, ...familyImages]);
  }

  const trustedKeys = new Set(dedupeImageVariants(trustedImages).map(image => {
    const parsed = new URL(image);
    return `${parsed.hostname.toLowerCase()}${decodeURIComponent(parsed.pathname).toLowerCase()}`;
  }));
  const fallbackImages = dedupeImageVariants(imageUrlsFromMarkup(html, pageUrl)).filter(image => {
    const parsed = new URL(image);
    const key = `${parsed.hostname.toLowerCase()}${decodeURIComponent(parsed.pathname).toLowerCase()}`;
    return !trustedKeys.has(key);
  });

  return {
    images: trustedImages.slice(0, limit),
    fallbackImages: fallbackImages.slice(0, 30),
  };
}

export function extractProductPageImages(html: string, pageUrl: string, limit = 10): string[] {
  return extractProductPageImageCandidates(html, pageUrl, limit).images;
}

export function normalizeProductImageCandidate(rawUrl: string, pageUrl: string): string | null {
  return normalizeImageUrl(rawUrl, pageUrl);
}

export function extractShopifyProductImages(payload: unknown, pageUrl: string, limit = 10): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const images = (payload as Record<string, unknown>).images;
  if (!Array.isArray(images)) return [];

  return dedupeImageVariants(images.flatMap(image => {
    if (typeof image === 'string') return normalizeImageUrl(image, pageUrl) ?? [];
    if (!image || typeof image !== 'object') return [];
    const record = image as Record<string, unknown>;
    const rawUrl = record.src ?? record.url;
    return typeof rawUrl === 'string' ? normalizeImageUrl(rawUrl, pageUrl) ?? [] : [];
  })).slice(0, limit);
}