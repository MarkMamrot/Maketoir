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