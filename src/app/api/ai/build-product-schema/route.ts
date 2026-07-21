import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { BrandProfileRepository } from '@/lib/db/BrandProfileRepository';
import { ProductsRepository } from '@/lib/db/ProductsRepository';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TemplateField {
  name: string;
  label: string;
  description: string;
  format: string;
  maxLength?: number;
  count?: number;       // for list fields like bullet points
  example: string | string[];
}

export interface ProductDescriptionTemplate {
  toneGuide: string;
  writingRules: string[];
  fields: TemplateField[];
  exampleProduct: {
    name: string;
    [key: string]: string | string[];
  };
  headingTag?: string;    // e.g. 'h2' | 'h3' | 'h4'  (overrides auto-detect from writingRules)
  headingColour?: string; // e.g. '#0F3A50'               (overrides auto-detect from writingRules)
}

export interface TitleSchema {
  toneGuide: string;
  maxLength: number;
  formatRules: string[];
  formulaExamples: string[];
}

export interface TagsSchema {
  instructions: string;
  requiredTags: string[];
  excludedTerms: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readBrandProfile(databaseId: string) {
  try {
    const row = await BrandProfileRepository.get(databaseId);
    if (!row) return null;
    return {
      mission:      row.mission          || '',
      uvp:          row.uvp              || '',
      tone:         row.tone             || '',
      demographics: row.demographics     || '',
      geo:          row.geo              || '',
      products:     row.hero_products    || '',
      pricing:      row.price_positioning || '',
      praises:      row.praises  || '',
      objections:   row.objections        || '',
      competitors:  row.competitors       || '',
      marketGap:    row.market_gap        || '',
      logoUrl:      row.logo_url          || '',
      brandColours: row.brand_colours     || '',
      shippingPolicy:    row.shipping_policy    || '',
      connectedSoftware: row.connected_software || '',
      operationsSummary: row.operations_summary || '',
      returnsPolicy:     row.returns_policy     || '',
      brandHistory:      row.brand_history      || '',
      physicalBranches:  row.physical_branches  || '',
    };
  } catch { return null; }
}

async function readSampleProducts(databaseId: string): Promise<string[][]> {
  try {
    const inventorySystemId = await resolveInventorySystemId(databaseId).catch(() => databaseId);
    // Try website_sheet_id for Shopify products first
    const conn = await ConnectionsRepository.get(databaseId).catch(() => null);
    const wsId = conn?.website_sheet_id;
    if (wsId) {
      const sheets = new GoogleSheetsService();
      const rows = await sheets.getData(wsId, 'Shopify_Products').catch(() => null);
      if (rows && rows.length > 1) return (rows as string[][]).slice(1, 8);
    }
    // Fall back to MySQL products
    const products = await ProductsRepository.list(inventorySystemId);
    return products.slice(0, 7).map(p => [
      String(p.code ?? ''),
      String(p.name ?? ''),
      String(p.brand ?? ''),
      String(p.retail_price ?? ''),
    ]);
  } catch { /* fall through */ }
  return [];
}

// ── Prompt builders ───────────────────────────────────────────────────────────

/** Shape description shared by both prompts — no mandatory field list */
const TEMPLATE_JSON_BASE = `Return a single JSON object with EXACTLY these keys — no markdown, no extra keys:
{
  "toneGuide": "A paragraph describing the voice, tone, and personality to use across all product descriptions.",
  "writingRules": ["Array of 4-8 concise dos and don'ts rules for writing product descriptions"],
  "fields": [
    {
      "name": "fieldName (camelCase key)",
      "label": "The actual heading text shown inside the product description — customer-visible, written in the brand voice (e.g. 'Key Features', 'Why You Will Love It', 'Dimensions & Materials', 'Gift Wrapping & Delivery'). NOT a template meta-name like 'Headline' or 'Short Description'. Should read naturally as a section heading within the product page.",
      "description": "What this field is and when to use it (internal note only, not shown to customers)",
      "format": "How to write it — structure, sentence pattern, etc.",
      "maxLength": 120,
      "example": "Example text or array of example strings for list fields"
    }
  ],
  "exampleProduct": {
    "name": "Product name taken from the sample products",
    "fieldName1": "Completed example value",
    "fieldName2": "Completed example value"
  }
}
IMPORTANT: Fields are ONLY for the visible customer-facing product description shown on the product page. Do NOT include SEO titles, meta descriptions, meta tags, schema markup, or any backend/technical fields. Those are managed separately.
The fields array must be tailored to the brand and product type — include as many or as few fields as make sense.
The label for each field is the ACTUAL HEADING that will appear in the product description. It must sound natural as a section heading a shopper would read, and reflect the brand's voice — not a template meta-name.
The exampleProduct must fill in every field using one real product from the sample products provided.
Respond with ONLY valid JSON, no markdown, no explanation.`;

/** For fresh generation only — suggests a useful starting set of fields */
const TEMPLATE_JSON_STRUCTURE = TEMPLATE_JSON_BASE + `

For a typical eCommerce brand, consider starting with fields such as: headline, shortDescription, longDescription, bulletPoints, calloutBadge — but adapt and add/remove freely based on the brand, product type, and customer.`;

function buildFreshPrompt(
  brandName: string,
  brandUrl: string,
  profile: Record<string, string> | null,
  sampleProducts: string[][],
  brandColours: Record<string, string> | null,
): string {
  const profileBlock = profile ? `
BRAND PROFILE:
- Mission: ${profile.mission}
- Unique Value Proposition: ${profile.uvp}
- Brand Tone: ${profile.tone}
- Target Demographics: ${profile.demographics}
- Geographic Markets: ${profile.geo}
- Hero Products: ${profile.products}
- Price Positioning: ${profile.pricing}
- Customer Praises: ${profile.praises}
- Customer Objections: ${profile.objections}
- Competitors: ${profile.competitors}
- Market Gap / Advantage: ${profile.marketGap}
- Logo URL: ${profile.logoUrl}
- Shipping Policy: ${profile.shippingPolicy}
- Returns Policy: ${profile.returnsPolicy}
- Connected Software: ${profile.connectedSoftware}
- Operations Summary: ${profile.operationsSummary}
- Brand History: ${profile.brandHistory}
- Physical Branches: ${profile.physicalBranches}
`.trim() : '';

  const coloursBlock = brandColours && Object.values(brandColours).some(Boolean) ? `
BRAND COLOURS (use these in your template where relevant — e.g. reference primary colour for hero callouts, accent for badges):
- Primary: ${brandColours.primary || 'not set'}
- Secondary: ${brandColours.secondary || 'not set'}
- Accent: ${brandColours.accent || 'not set'}
- Neutral: ${brandColours.neutral || 'not set'}
- Background: ${brandColours.background || 'not set'}
`.trim() : '';

  const productHeaders = ['id','variant_id','handle','title','status','product_type','vendor','tags','description_html','price','compare_at_price','sku','barcode','inventory_qty','weight','image_url','variant_count','image_count','published_at','updated_at'];
  const productsBlock = sampleProducts.length > 0 ? `
SAMPLE PRODUCTS (from Shopify — up to 7 rows):
${sampleProducts.map(row => {
    const get = (col: string) => row[productHeaders.indexOf(col)] || '';
    return `- ${get('title')} | Type: ${get('product_type')} | Price: $${get('price')} | Tags: ${get('tags')}`;
  }).join('\n')}
`.trim() : '';

  return `
You are an expert eCommerce copywriter and product content strategist.
Your task is to build a Product Description Template for the brand "${brandName}" (${brandUrl}).
This template will be used as a content guide — every product on the website will be written following this template.

${profileBlock}

${coloursBlock ? coloursBlock + '\n\n' : ''}${productsBlock}

Based on the brand personality, target customer, price point, and product types above — design a product description template that:
1. Matches the brand voice and tone
2. Is optimised for conversion at this price point
3. Addresses the key customer praises and objections
4. Has clear, structured fields that a non-copywriter could follow
5. Includes only the fields that genuinely add value for this brand/product type

${TEMPLATE_JSON_STRUCTURE}
`.trim();
}

function buildRefinePrompt(
  brandName: string,
  existingTemplate: ProductDescriptionTemplate,
  userComments: string,
): string {
  return `
You are an expert eCommerce copywriter refining a product description template for "${brandName}".

CURRENT TEMPLATE:
${JSON.stringify(existingTemplate, null, 2)}

USER REVISION NOTES:
${userComments}

Instructions:
- Apply the user's requested changes carefully and literally. If they ask to remove a field, remove it.
- Add or rename fields exactly as requested.
- Update the exampleProduct to match the revised field list — remove keys for deleted fields, add keys for new ones.
- Keep the same JSON structure.
- Do NOT reintroduce fields the user asked to remove.
- Do NOT include SEO titles, meta descriptions, or any other backend/technical fields — only visible customer-facing copy fields.

${TEMPLATE_JSON_BASE}
`.trim();
}

function buildRegenExamplePrompt(
  existingTemplate: ProductDescriptionTemplate,
  sampleProducts: string[][],
): string {
  const products = sampleProducts.slice(1, 8).map((r: string[]) => r[1]?.trim()).filter(Boolean);
  const productList = products.length > 0 ? products.join(', ') : 'the brand\'s products';
  const currentName = existingTemplate.exampleProduct?.name ?? '';
  const fieldDescriptions = existingTemplate.fields.map(f => {
    const isArr = f.count || Array.isArray(f.example);
    return `- "${f.name}" (${isArr ? `array of ${f.count ?? 3} strings` : 'string'}): ${f.format ?? f.description ?? ''}`;
  }).join('\n');
  return `You are an expert eCommerce copywriter. Generate fresh, vivid example product copy for this template.

TEMPLATE TONE:
${existingTemplate.toneGuide}

WRITING RULES:
${(existingTemplate.writingRules ?? []).map(r => `- ${r}`).join('\n')}

AVAILABLE PRODUCTS:
${productList}
${currentName ? `\nPlease use a DIFFERENT product than the current example: "${currentName}"` : ''}
FIELDS TO FILL:
${fieldDescriptions}

TASK: Fill in every field with realistic, compelling copy for one of the available products. Follow the tone and writing rules strictly.

Return ONLY valid JSON — no markdown, no explanation:
{
  "exampleProduct": {
    "name": "Product name",
    "field1": "value or array"
  }
}`.trim();
}

// ── Title schema prompt builders ──────────────────────────────────────────────

function buildTitlePrompt(
  brandName: string,
  profile: Record<string, string> | null,
  sampleProducts: string[][],
): string {
  const profileBlock = profile ? `
BRAND PROFILE:
- Mission: ${profile.mission}
- Unique Value Proposition: ${profile.uvp}
- Brand Tone: ${profile.tone}
- Target Demographics: ${profile.demographics}
- Geographic Markets: ${profile.geo}
- Hero Products: ${profile.products}
- Price Positioning: ${profile.pricing}
- Customer Praises: ${profile.praises}
- Customer Objections: ${profile.objections}
- Competitors: ${profile.competitors}
- Market Gap / Advantage: ${profile.marketGap}
- Logo URL: ${profile.logoUrl}
- Shipping Policy: ${profile.shippingPolicy}
- Returns Policy: ${profile.returnsPolicy}
- Connected Software: ${profile.connectedSoftware}
- Operations Summary: ${profile.operationsSummary}
- Brand History: ${profile.brandHistory}
- Physical Branches: ${profile.physicalBranches}
`.trim() : '';

  const productHeaders = ['id','variant_id','handle','title','status','product_type','vendor','tags','description_html','price','compare_at_price','sku','barcode','inventory_qty','weight','image_url','variant_count','image_count','published_at','updated_at'];
  const productsBlock = sampleProducts.length > 0 ? `
SAMPLE PRODUCTS:
${sampleProducts.map(row => {
    const get = (col: string) => row[productHeaders.indexOf(col)] || '';
    return `- ${get('title')} | Type: ${get('product_type')} | Price: $${get('price')}`;
  }).join('\n')}
`.trim() : '';

  return `
You are an expert eCommerce SEO and conversion specialist.
Your task is to build a Product Title Schema for the brand "${brandName}".
This schema defines rules the AI follows every time it writes or rewrites a product title.

${profileBlock}

${productsBlock}

Based on the brand, product types, and price point above — design a title schema that:
1. Balances SEO discoverability with brand voice
2. Is consistent and scannable in search results and collection pages
3. Avoids filler words and repetition
4. Fits within the recommended character limit for Shopify titles

Return a single JSON object with EXACTLY these keys — no markdown, no extra keys:
{
  "toneGuide": "One paragraph describing how product titles should sound — the voice, brevity, and personality.",
  "maxLength": 70,
  "formatRules": [
    "4-8 concise rules for constructing titles — e.g. 'Start with brand name', 'Include key attribute after a dash', 'Never repeat the category word'"
  ],
  "formulaExamples": [
    "2-4 example formulas showing the title structure, e.g. '[Brand] [Product Name] – [Key Attribute]'"
  ]
}
Respond with ONLY valid JSON, no markdown, no explanation.
`.trim();
}

// ── Tags schema prompt builders ───────────────────────────────────────────────

function buildTagsPrompt(
  brandName: string,
  profile: Record<string, string> | null,
  sampleProducts: string[][],
): string {
  const profileBlock = profile ? `
BRAND PROFILE:
- Mission: ${profile.mission}
- Unique Value Proposition: ${profile.uvp}
- Brand Tone: ${profile.tone}
- Target Demographics: ${profile.demographics}
- Geographic Markets: ${profile.geo}
- Hero Products: ${profile.products}
- Price Positioning: ${profile.pricing}
- Customer Praises: ${profile.praises}
- Customer Objections: ${profile.objections}
- Competitors: ${profile.competitors}
- Market Gap / Advantage: ${profile.marketGap}
- Logo URL: ${profile.logoUrl}
- Shipping Policy: ${profile.shippingPolicy}
- Returns Policy: ${profile.returnsPolicy}
- Connected Software: ${profile.connectedSoftware}
- Operations Summary: ${profile.operationsSummary}
- Brand History: ${profile.brandHistory}
- Physical Branches: ${profile.physicalBranches}
`.trim() : '';

  const productHeaders = ['id','variant_id','handle','title','status','product_type','vendor','tags','description_html','price','compare_at_price','sku','barcode','inventory_qty','weight','image_url','variant_count','image_count','published_at','updated_at'];
  const productsBlock = sampleProducts.length > 0 ? `
SAMPLE PRODUCTS (showing existing tags for reference):
${sampleProducts.map(row => {
    const get = (col: string) => row[productHeaders.indexOf(col)] || '';
    return `- ${get('title')} | Tags: ${get('tags') || '(none)'}`;
  }).join('\n')}
`.trim() : '';

  return `
You are an expert eCommerce merchandising and SEO specialist.
Your task is to build a Product Tagging Strategy for the brand "${brandName}".
This schema defines the rules the AI follows every time it writes or rewrites product tags.

${profileBlock}

${productsBlock}

Tags on Shopify are used for filtering, collections, and internal search. Design a tagging strategy that:
1. Makes products easy to find and filter
2. Is consistent in naming conventions (e.g. always lowercase, always use hyphens)
3. Covers useful dimensions like material, colour, use-case, audience, and occasion
4. Includes brand-specific tags that are always required
5. Avoids generic noise words and redundant tags

Return a single JSON object with EXACTLY these keys — no markdown, no extra keys:
{
  "instructions": "Comprehensive paragraph-style instructions for the AI: what dimensions to tag (material, colour, use-case, audience, occasion, etc.), naming conventions (case, separators), max tag count, and any brand-specific rules.",
  "requiredTags": ["Tags that MUST always be included on every product, e.g. the brand name"],
  "excludedTerms": ["Words or phrases to NEVER use as tags — e.g. generic filler words, competitor names"]
}
Respond with ONLY valid JSON, no markdown, no explanation.
`.trim();
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { user, response: authResponse } = requireAdminSession();
    if (authResponse) return authResponse;

    const body = await req.json();
    const { databaseId, mode, existingSchema, userComments } = body;
    const type: 'description' | 'title' | 'tags' = body.type || 'description';

    if (!databaseId) {
      return NextResponse.json({ error: 'Missing databaseId.' }, { status: 400 });
    }
    const denied = assertBusinessAccess(user, databaseId);
    if (denied) return denied;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API key not configured.' }, { status: 500 });
    }

    // ── 1. Look up Gemini model ──────────────────────────────────────────────
    let modelId = 'gemini-2.5-pro-preview';
    try {
      const conn = await ConnectionsRepository.get(databaseId).catch(() => null);
      if (conn?.gemini_model) modelId = conn.gemini_model;
    } catch { /* use default */ }

    // ── 2. Handle title / tags types (simpler — always fresh generation) ────
    if (type === 'title' || type === 'tags') {
      const [profile, sampleProducts, infoRes] = await Promise.all([
        readBrandProfile(databaseId),
        readSampleProducts(databaseId),
        fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/user/business-info?databaseId=${encodeURIComponent(databaseId)}`, {
          headers: { cookie: req.headers.get('cookie') || '' },
        }).then(r => r.ok ? r.json() : {}).catch(() => ({})) as Promise<Record<string, any>>,
      ]);

      const brandName: string = infoRes.brandName || 'Brand';
      const promptText = type === 'title'
        ? buildTitlePrompt(brandName, profile, sampleProducts)
        : buildTagsPrompt(brandName, profile, sampleProducts);

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({ model: modelId, contents: promptText });
      const text = response.text?.trim() ?? '';
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

      try {
        const parsed = JSON.parse(cleaned);
        if (type === 'title') return NextResponse.json({ success: true, titleSchema: parsed as TitleSchema });
        return NextResponse.json({ success: true, tagsSchema: parsed as TagsSchema });
      } catch {
        console.error(`Gemini returned non-JSON for ${type}:`, text.slice(0, 200));
        return NextResponse.json({ error: 'AI returned an unexpected format. Please try again.' }, { status: 500 });
      }
    }

    // ── 3. Description type (existing logic) ─────────────────────────────────
    const isRefine = mode === 'refine';
    const isRegenExample = mode === 'regen-example';

    // ── 3a. Regen example product only ──────────────────────────────────────
    if (isRegenExample) {
      if (!existingSchema) {
        return NextResponse.json({ error: 'Missing existing schema for example regeneration.' }, { status: 400 });
      }
      const sampleProducts = await readSampleProducts(databaseId);
      const promptText = buildRegenExamplePrompt(existingSchema as ProductDescriptionTemplate, sampleProducts);
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({ model: modelId, contents: promptText });
      const text = response.text?.trim() ?? '';
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      try {
        const parsed = JSON.parse(cleaned);
        if (!parsed.exampleProduct) throw new Error('Missing exampleProduct key');
        return NextResponse.json({ success: true, exampleProduct: parsed.exampleProduct });
      } catch {
        console.error('Gemini returned non-JSON for regen-example:', text.slice(0, 200));
        return NextResponse.json({ error: 'AI returned an unexpected format. Please try again.' }, { status: 500 });
      }
    }

    if (isRefine && (!existingSchema || !userComments?.trim())) {
      return NextResponse.json({ error: 'Missing existing template or comments for refinement.' }, { status: 400 });
    }

    let promptText: string;

    if (isRefine) {
      promptText = buildRefinePrompt(
        body.brandName || 'Brand',
        existingSchema as ProductDescriptionTemplate,
        userComments,
      );
    } else {
      const [profile, sampleProducts, infoRes] = await Promise.all([
        readBrandProfile(databaseId),
        readSampleProducts(databaseId),
        fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/user/business-info?databaseId=${encodeURIComponent(databaseId)}`, {
          headers: { cookie: req.headers.get('cookie') || '' },
        }).then(r => r.ok ? r.json() : {}).catch(() => ({})) as Promise<Record<string, any>>,
      ]);

      const brandName: string = infoRes.brandName || 'Brand';
      const brandUrl: string = infoRes.brandUrl || '';

      let brandColours: Record<string, string> | null = null;
      if (profile?.brandColours) {
        try {
          const parsed = JSON.parse(profile.brandColours);
          if (typeof parsed === 'object' && !Array.isArray(parsed)) brandColours = parsed;
        } catch { /* no colours */ }
      }

      promptText = buildFreshPrompt(brandName, brandUrl, profile, sampleProducts, brandColours);
    }

    // ── 4. Call Gemini for description ───────────────────────────────────────
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({ model: modelId, contents: promptText });
    const text = response.text?.trim() ?? '';
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let template: ProductDescriptionTemplate;
    try {
      template = JSON.parse(cleaned);
    } catch {
      console.error('Gemini returned non-JSON:', text.slice(0, 200));
      return NextResponse.json({ error: 'AI returned an unexpected format. Please try again.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, template });

  } catch (error: any) {
    console.error('build-product-description error:', error);
    return NextResponse.json({ error: 'Failed to generate product description template.' }, { status: 500 });
  }
}
