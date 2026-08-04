const PRODUCT_SECTION = /(product description|details|dimensions|features|specifications|materials|composition|size|sizing|fit|care)/i;
const EXCLUDED_SECTION = /(shipping|delivery|returns?|exchanges?|payment|warrant|reviews?|stockist|contact)/i;

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return decodeHtml(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function brandName(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return String((value as Record<string, unknown>).name ?? '');
  return '';
}

function meaningfulText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = plainText(value);
  return text && !/^(?:0|null|undefined|n\/a)$/i.test(text) ? text : '';
}

function collectProductNodes(value: unknown, target: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    value.forEach(item => collectProductNodes(item, target));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
  if (types.some(type => type === 'Product' || type === 'ProductGroup')) target.push(record);
  if (record['@graph']) collectProductNodes(record['@graph'], target);
}

export function extractProductPageFacts(html: string, sourceUrl: string): string {
  const blocks: string[] = [`APPROVED SOURCE: ${sourceUrl}`];
  const productNodes: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectProductNodes(JSON.parse(match[1]), productNodes);
    } catch {
      // Ignore malformed third-party structured data.
    }
  }

  const product = productNodes[0];
  if (product) {
    const identity = [
      product.name ? `Product: ${plainText(String(product.name))}` : '',
      product.brand ? `Brand: ${plainText(brandName(product.brand))}` : '',
      product.sku ? `SKU: ${plainText(String(product.sku))}` : '',
      product.gtin ? `GTIN: ${plainText(String(product.gtin))}` : '',
      product.category ? `Category: ${plainText(String(product.category))}` : '',
    ].filter(Boolean);
    if (identity.length > 0) blocks.push(identity.join('\n'));
    const description = plainText(product.description);
    if (description) blocks.push(`SUPPLIER PRODUCT DESCRIPTION:\n${description}`);
  }

  for (const match of html.matchAll(/<details\b[^>]*>[\s\S]*?<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi)) {
    const title = plainText(match[1]);
    if (!title || EXCLUDED_SECTION.test(title) || !PRODUCT_SECTION.test(title)) continue;
    const content = plainText(match[2]);
    if (content) blocks.push(`${title.toUpperCase()}:\n${content}`);
  }

  return [...new Set(blocks)].join('\n\n').slice(0, 16_000);
}

export function extractShopifyProductFacts(payload: unknown, sourceUrl: string): string {
  if (!payload || typeof payload !== 'object') return '';
  const product = payload as Record<string, unknown>;
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const firstVariant = variants[0] && typeof variants[0] === 'object'
    ? variants[0] as Record<string, unknown>
    : {};
  const title = meaningfulText(product.title);
  const vendor = meaningfulText(product.vendor);
  const sku = meaningfulText(firstVariant.sku);
  const barcode = meaningfulText(firstVariant.barcode);
  const productType = meaningfulText(product.type);
  const identity = [
    title ? `Product: ${title}` : '',
    vendor ? `Brand: ${vendor}` : '',
    sku ? `SKU: ${sku}` : '',
    barcode ? `GTIN: ${barcode}` : '',
    productType ? `Category: ${productType}` : '',
  ].filter(Boolean);
  const description = plainText(product.description ?? product.body_html);
  if (identity.length === 0 && !description) return '';

  const blocks = [
    `APPROVED SOURCE: ${canonicalSourceUrl(sourceUrl)}`,
    identity.join('\n'),
    description ? `SUPPLIER PRODUCT DESCRIPTION:\n${description}` : '',
  ].filter(Boolean);
  return blocks.join('\n\n').slice(0, 16_000);
}

function canonicalSourceUrl(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    url.pathname = url.pathname.replace(/\.js$/, '');
    url.search = '';
    return url.href;
  } catch {
    return sourceUrl;
  }
}