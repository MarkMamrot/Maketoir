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