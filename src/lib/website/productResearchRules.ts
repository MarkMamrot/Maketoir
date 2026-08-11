export const PRODUCT_RESEARCH_RULES = `PRODUCT FACT RULES (mandatory):
- Treat facts extracted from the single approved product page as the authoritative source. Do not supplement them with facts from search snippets, related products, recommendation carousels, similarly named products, or general product knowledge.
- Use only facts about this exact product: features, materials, construction, fit, sizing, colours, technology, specifications, care, intended use, and product dimensions.
- Actively look for product dimensions or measurements in specification tables, accordions, structured data, image alt text, and retailer descriptions. Preserve units exactly as sourced.
- Never infer or invent dimensions. If no reliable measurements are found, omit them rather than guessing.
- Identify the one or two strongest supplier-stated differentiators, such as unusual size, construction, material, craftsmanship, or a novel use case. Emphasise them naturally in the opening one or two sentences before supporting detail.
- Prefer concrete sourced benefits and specifications over generic lifestyle filler. Do not bury a major selling point near the end of the description.
- Exclude all retailer or website boilerplate: shipping costs, free-shipping thresholds, delivery estimates, dispatch times, returns, exchanges, warranties that are store policies, promotions, loyalty offers, payment options, stock messages, store locations, and contact information.
- Do not describe packaging dimensions as product dimensions unless the source explicitly identifies them as the product's measurements.`;

export function productResearchQuery(productName: string, brand: string, url?: string): string {
  const source = url ? `Use the product page ${url}. ` : '';
  return `${source}Research only the exact product "${productName}" by ${brand}. Find product features, materials, specifications, sizing, and dimensions or measurements. Exclude shipping, delivery, returns, promotions, pricing, stock messages, and other retailer policies.`;
}

export function productSearchQueries(productName: string, brand: string, code?: string, barcode?: string): string[] {
  const normalizedNameWords = new Set(productName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const brandWords = brand.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const nameIncludesBrand = brandWords.length > 0 && brandWords.every(word => normalizedNameWords.has(word));
  const searchableName = productName.replace(/["“”]+/g, '').replace(/\s+/g, ' ').trim();
  const broadQuery = [searchableName, nameIncludesBrand ? '' : brand.trim()].filter(Boolean).join(' ');
  const identifiers = [code, barcode]
    .map(value => value?.trim() ?? '')
    .filter((value, index, values) => value.length >= 4 && values.indexOf(value) === index);

  return [...new Set([
    broadQuery,
    ...identifiers,
  ].filter(Boolean))];
}

export interface ProductResearchVariant {
  sku?: string | null;
  barcode?: string | null;
  price_rrp?: string | number | null;
  option1_value?: string | null;
  option2_value?: string | null;
  option3_value?: string | null;
  variant_label?: string | null;
}

export function selectProductResearchVariant<T extends ProductResearchVariant>(productName: string, variants: T[]): T | undefined {
  if (variants.length === 0) return undefined;
  const normalizedName = productName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const nameWords = new Set(normalizedName.split(/\s+/).filter(Boolean));

  const score = (variant: T): number => {
    const optionValues = [variant.option1_value, variant.option2_value, variant.option3_value, variant.variant_label]
      .map(value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
      .filter(value => value.length >= 3 && value !== 'default');
    const optionScore = optionValues.reduce((total, value) =>
      total + (normalizedName.includes(value) ? 100 + value.length : 0), 0);
    const skuScore = String(variant.sku ?? '').toLowerCase().split(/[^a-z0-9]+/)
      .filter(token => token.length >= 3 && nameWords.has(token))
      .reduce((total, token) => total + token.length, 0);
    return optionScore + skuScore;
  };

  return variants.reduce((best, variant) => score(variant) > score(best) ? variant : best, variants[0]);
}
