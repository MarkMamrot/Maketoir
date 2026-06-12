import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleGenAI } from '@google/genai';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { SalesRepository } from '@/lib/db/SalesRepository';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { decrypt } from '@/lib/encryption';

// ── Logo auto-detection ───────────────────────────────────────────────────────

/** Resolves a potentially-relative URL against a base URL. */
function resolveUrl(href: string, base: string): string {
  try { return new URL(href, base).href; } catch { return href; }
}

/**
 * Fetches the brand URL and extracts the most likely logo image URL from
 * og:image, apple-touch-icon, or an <img> with "logo" in alt/src.
 */
async function fetchLogoFromWebsite(brandUrl: string): Promise<string | null> {
  try {
    const res = await fetch(brandUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Marketoir/1.0)' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // og:image (most common — also used as logo by Shopify/WooCommerce)
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
            ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (og?.[1]) return resolveUrl(og[1], brandUrl);

    // apple-touch-icon
    const touch = html.match(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
               ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*apple-touch-icon[^"']*["']/i);
    if (touch?.[1]) return resolveUrl(touch[1], brandUrl);

    // <img alt="...logo..."> or src containing /logo
    const logoImg = html.match(/<img[^>]+alt=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/i)
                 ?? html.match(/<img[^>]+src=["']([^"'\/]*\/logo[^"']*)["']/i);
    if (logoImg?.[1]) return resolveUrl(logoImg[1], brandUrl);

    return null;
  } catch {
    return null;
  }
}

async function scrapeLoyaltyProgramContent(brandUrl: string): Promise<string> {
  const base = brandUrl.replace(/\/$/, '');
  const LOYALTY_KEYWORDS = /loyal|reward|vip|points?|member|perks?|club|refer|referral/i;

  const stripHtml = (html: string) =>
    html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

  const fetchRaw = async (url: string): Promise<string | null> => {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Marketoir/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      return await r.text();
    } catch {
      return null;
    }
  };

  const fetchPage = async (url: string): Promise<string | null> => {
    const raw = await fetchRaw(url);
    return raw ? stripHtml(raw) : null;
  };

  const homepageRaw = await fetchRaw(base + '/');
  if (!homepageRaw) return '';

  const snippets: string[] = [];
  const discoveredPaths: string[] = [];

  // Focus on top-menu/footer/nav areas first, as requested.
  const regionMatches = homepageRaw.match(/<(?:header|nav|footer)[^>]*>[\s\S]*?<\/(?:header|nav|footer)>/gi) || [];
  const regionHtml = regionMatches.join(' ') || homepageRaw;

  const linkRegex = /href=["']([^"'#?][^"']*)["'][^>]*>([^<]{0,100})</gi;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(regionHtml)) !== null) {
    const href = m[1].trim();
    const label = m[2].trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    if (!LOYALTY_KEYWORDS.test(href) && !LOYALTY_KEYWORDS.test(label)) continue;
    try {
      const resolved = href.startsWith('http') ? new URL(href) : new URL(href, base);
      if (resolved.hostname !== new URL(base).hostname) continue;
      const path = resolved.pathname;
      if (!discoveredPaths.includes(path)) discoveredPaths.push(path);
    } catch {
      // Skip malformed links
    }
  }

  const fallbackPaths = [
    '/pages/loyalty',
    '/pages/rewards',
    '/pages/vip',
    '/pages/refer-a-friend',
    '/loyalty',
    '/rewards',
    '/vip',
    '/rewards-program',
  ];

  const seen = new Set<string>();
  const candidates = [...discoveredPaths, ...fallbackPaths].filter(p => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  // Include loyalty mentions on homepage itself.
  const homepageText = stripHtml(regionHtml || homepageRaw);
  if (LOYALTY_KEYWORDS.test(homepageText)) {
    snippets.push(`[From homepage menu/footer content]:\n${homepageText.slice(0, 2500)}`);
  }

  for (const path of candidates.slice(0, 8)) {
    const text = await fetchPage(base + path);
    if (!text || text.length < 120) continue;
    snippets.push(`[From ${path}]:\n${text.slice(0, 3500)}`);
    if (snippets.length >= 4) break;
  }

  return snippets.join('\n\n');
}

// ── Sales data aggregation ────────────────────────────────────────────────────

interface SalesSummary {
  totalRevenue: number;
  totalOrders: number;
  aov: number;
  heroProducts: { name: string; revenue: number; qty: number }[];
  productCount: number;
}

// ── Connected software context builder ────────────────────────────────────────

// Columns that are secret credentials — we note their presence but hide the value
const SECRET_COLS = new Set(['ShopifyAccessToken', 'MetaAccessToken', 'Cin7ApiKey', 'KlaviyoApiKey', 'GoogleAdsRefreshToken', 'GmailRefreshToken']);

/**
 * Reads the Connections row and returns a human-readable context string for AI.
 * Shows which columns have values set (without revealing secret values).
 */
async function buildConnectionsContext(databaseId: string): Promise<string> {
  try {
    const conn = await ConnectionsRepository.get(databaseId);
    if (!conn) return '';
    const fieldMap: [string, string | null][] = [
      ['Cin7AccountId',         conn.cin7_account_id],
      ['Cin7ApiKey',            conn.cin7_api_key],
      ['ShopifyShopId',         conn.shopify_shop_id],
      ['ShopifyAccessToken',    conn.shopify_access_token],
      ['MetaAdAccountId',       conn.meta_ad_account_id],
      ['MetaAccessToken',       conn.meta_access_token],
      ['GA4PropertyId',         conn.ga4_property_id],
      ['GoogleAdsCustomerId',   conn.google_ads_customer_id],
      ['GoogleAdsRefreshToken', conn.google_ads_refresh_token],
      ['KlaviyoApiKey',         conn.klaviyo_api_key],
    ];
    const lines = fieldMap
      .filter(([, val]) => val && val.trim())
      .map(([key, val]) => `  ${key}: ${SECRET_COLS.has(key) ? '[set]' : val}`);
    if (lines.length === 0) return '';
    return `CONNECTIONS TAB (fields that have values configured — use these to determine connectedSoftware):\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

async function loadSalesSummary(inventorySystemId: string): Promise<SalesSummary | null> {
  try {
    const salesRows = await SalesRepository.query(inventorySystemId, {});
    if (!salesRows || salesRows.length === 0) return null;

    const productMap = new Map<string, { revenue: number; qty: number }>();
    const orderIds   = new Set<string>();
    let totalRevenue = 0;

    for (const row of salesRows) {
      const name = row.name ?? '';
      const lt   = Number(row.line_total ?? 0);
      const qty  = Number(row.qty ?? 0);
      const oid  = row.order_id ?? '';

      if (oid) orderIds.add(String(oid));
      if (!name || lt <= 0) continue;

      totalRevenue += lt;
      const prev = productMap.get(name) ?? { revenue: 0, qty: 0 };
      productMap.set(name, { revenue: prev.revenue + lt, qty: prev.qty + qty });
    }

    const totalOrders = orderIds.size;
    const aov         = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const sorted  = Array.from(productMap.entries()).sort((a, b) => b[1].revenue - a[1].revenue);
    const topN    = Math.min(20, Math.max(3, Math.ceil(sorted.length * 0.05)));
    const heroProducts = sorted.slice(0, topN).map(([name, { revenue, qty }]) => ({ name, revenue, qty }));

    return { totalRevenue, totalOrders, aov, heroProducts, productCount: productMap.size };
  } catch (e: any) {
    console.warn('[brand-profile] Could not load sales:', e.message);
    return null;
  }
}

// ── AI prompts ────────────────────────────────────────────────────────────────

const PROFILE_SCHEMA = `Return a JSON object with EXACTLY these keys — no extra keys, no markdown:
- mission: The brand's core mission in 1-2 sentences.
- uvp: The unique value proposition in 1-2 sentences.
- tone: The brand tone and voice (e.g. "Bold, playful, aspirational").
- demographics: Target customer demographics (age, gender, lifestyle).
- geo: Top geographies with approximate percentages if known.
- products: Hero products as a numbered list.
- pricing: Price positioning and AOV.
- praises: 3-5 common customer praise themes based on typical reviews for this type of brand.
- objections: 3-5 common customer objections or friction points.
- competitors: 3-5 main competitors.
- marketGap: Where this brand has a competitive advantage or underserved niche.
- shippingPolicy: A clear, customer-facing description of the brand's shipping policy. Include estimated delivery times, free shipping thresholds if applicable, and any notable conditions. Write it as it would appear in a product description or FAQ — natural and reassuring tone.
- returnsPolicy: A short, factual summary of the brand's returns/refund policy based on what is publicly stated. Include the return window, key conditions, and refund method. If unknown, return an empty string.
- brandHistory: A 3-6 sentence narrative covering when and where the brand was founded, who founded it, what inspired it, and any notable milestones. Base this only on what is discoverable from the website and social media — do not invent details. If unknown, return an empty string.
- physicalBranches: A structured list of all physical store/branch locations found on the website. For each branch include: name, full address, phone number, and opening hours. Format as plain text with one branch per block. If no physical stores exist, return an empty string.
- loyaltyProgram: A concise summary of the loyalty/rewards program using website content. Include program name, how customers earn points/rewards, how redemption works, and key perks/tiers if available. If no loyalty program is found, return an empty string.
- connectedSoftware: A comma-separated list of the software platforms this business connects to (e.g. "Cin7 Omni, Shopify, Google Ads"). Leave as empty string if unknown.
- brandColours: An object with exactly these five keys — primary, secondary, accent, neutral, background — each containing a single HEX colour code (e.g. "#1A2B3C").
- logoUrl: The most likely URL of the brand's primary logo image (empty string if unknown).

Respond with ONLY valid JSON, no markdown, no explanation.`;

const PROMPT = (
  brandName: string,
  brandUrl: string,
  salesContext: string,
  connectionsContext: string,
  hasLogo: boolean,
) => `
You are a brand strategist. Analyze the brand "${brandName}" at ${brandUrl}.
${hasLogo ? 'An image of the brand logo has been provided. Analyze it for colour extraction.' : ''}

${salesContext}

${connectionsContext}

${PROFILE_SCHEMA.replace(
  '- products: Hero products as a numbered list.',
  `- products: Hero products as a numbered list${salesContext ? ' — derived from the sales data provided above' : ''}.`,
).replace(
  '- pricing: Price positioning and AOV.',
  `- pricing: Price positioning and AOV${salesContext ? ' — calculated from the sales data above' : ' — estimated'}.`,
).replace(
  '- brandColours: An object with exactly these five keys — primary, secondary, accent, neutral, background — each containing a single HEX colour code (e.g. "#1A2B3C").',
  `- brandColours: An object with exactly these five keys — primary, secondary, accent, neutral, background — each containing a single HEX colour code (e.g. "#1A2B3C") that best represents that role in the brand's visual identity${hasLogo ? ', extracted from the provided logo image' : ', inferred from the website and brand identity'}.`,
)}
`.trim();

const REFINE_PROMPT = (
  brandName: string,
  existingProfile: Record<string, any>,
  userComments: string,
  salesContext: string,
  connectionsContext: string,
  hasLogo: boolean,
) => `
You are a brand strategist refining an existing brand profile for "${brandName}".
${hasLogo ? 'An image of the brand logo has been provided.' : ''}

CURRENT PROFILE (update only what needs changing based on the feedback below):
${JSON.stringify(existingProfile, null, 2)}

USER FEEDBACK / REVISION NOTES:
${userComments}

${salesContext ? `${salesContext}\n` : ''}${connectionsContext ? `${connectionsContext}\n` : ''}Instructions:
- Take the user's feedback seriously and apply their corrections and additions.
- Keep any fields that the user has not commented on unless you have strong reason to improve them.
- For brandColours, only change colours if the user specifically mentions colours or if you have the logo image available to re-extract from.

${PROFILE_SCHEMA}
`.trim();

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const sessionCookie = cookies().get('marketoir_session');
    if (!sessionCookie?.value) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const body = await req.json();
    const { brandUrl, brandName, databaseId, logoBase64, logoMimeType, mode, existingProfile, userComments, fieldKey } = body;

    const isRefine = mode === 'refine';
    const isFieldRegen = mode === 'regenerate-field';

    // ── Single-field regeneration (fast path) ──────────────────────────────
    if (isFieldRegen) {
      if (!fieldKey || !existingProfile || !brandName) {
        return NextResponse.json({ error: 'Missing fieldKey, existingProfile, or brandName.' }, { status: 400 });
      }
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return NextResponse.json({ error: 'Gemini API key not configured.' }, { status: 500 });

      let modelId = 'gemini-2.5-pro-preview';
      if (databaseId) {
        try {
          const conn = await ConnectionsRepository.get(databaseId).catch(() => null);
          if (conn?.gemini_model) modelId = conn.gemini_model;
        } catch { /* use default */ }
      }

      // ── For shippingPolicy: scrape the brand's shipping page for real data ──
      let shippingPageContent = '';
      if (fieldKey === 'shippingPolicy' && brandUrl) {
        const base = brandUrl.replace(/\/$/, '');
        const SHIPPING_KEYWORDS = /ship|deliver|dispatch|postage|freight/i;

        // Helper: strip scripts/styles/tags and collapse whitespace
        const stripHtml = (html: string) =>
          html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();

        // Helper: fetch a URL and return stripped text (or null on failure)
        const fetchPage = async (url: string): Promise<string | null> => {
          try {
            const r = await fetch(url, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Marketoir/1.0)' },
              signal: AbortSignal.timeout(7000),
            });
            if (!r.ok) return null;
            return stripHtml(await r.text());
          } catch { return null; }
        };

        // Step 1: Fetch homepage and scan header/footer/nav for shipping links
        const discoveredPaths: string[] = [];
        const homepageHtml = await (async () => {
          try {
            const r = await fetch(base + '/', {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Marketoir/1.0)' },
              signal: AbortSignal.timeout(7000),
            });
            return r.ok ? await r.text() : '';
          } catch { return ''; }
        })();

        if (homepageHtml) {
          // Extract links from header, nav, and footer regions
          const regionMatches = homepageHtml.match(/<(?:header|nav|footer)[^>]*>[\s\S]*?<\/(?:header|nav|footer)>/gi) || [];
          const regionHtml = regionMatches.join(' ') || homepageHtml; // fallback: all links
          const linkRegex = /href=["']([^"']+)["'][^>]*>([^<]*)</gi;
          let m: RegExpExecArray | null;
          while ((m = linkRegex.exec(regionHtml)) !== null) {
            const href = m[1];
            const label = m[2];
            if (SHIPPING_KEYWORDS.test(href) || SHIPPING_KEYWORDS.test(label)) {
              const path = href.startsWith('http')
                ? (new URL(href)).pathname
                : href.startsWith('/') ? href : '/' + href;
              if (!discoveredPaths.includes(path)) discoveredPaths.push(path);
            }
          }
        }

        // Step 2: Hardcoded fallback candidates
        const fallbackCandidates = [
          '/policies/shipping',
          '/pages/shipping',
          '/pages/shipping-policy',
          '/pages/delivery',
          '/shipping',
          '/shipping-policy',
          '/delivery',
          '/pages/returns-and-shipping',
        ];

        // Try discovered paths first, then fallbacks (skip duplicates)
        const seen = new Set<string>();
        const allCandidates = [...discoveredPaths, ...fallbackCandidates].filter(p => {
          if (seen.has(p)) return false;
          seen.add(p);
          return true;
        });

        for (const path of allCandidates) {
          const text = await fetchPage(base + path);
          if (text && text.length > 200) {
            shippingPageContent = text.slice(0, 4000);
            break;
          }
        }
      }

      const shippingContext = shippingPageContent
        ? `\nSHIPPING PAGE CONTENT SCRAPED FROM THE BRAND WEBSITE:\n${shippingPageContent}\n\nUse the above scraped content as the primary source of truth for the shipping policy. Extract real times, prices, free shipping thresholds, and conditions. Summarise it in a natural customer-facing tone.`
        : '';

      // ── For returnsPolicy: scrape the brand's returns/refund page ──────────
      let returnsPageContent = '';
      if (fieldKey === 'returnsPolicy' && brandUrl) {
        const base = brandUrl.replace(/\/$/, '');
        const RETURNS_KEYWORDS = /return|refund|exchange|restock/i;

        const stripHtml = (html: string) =>
          html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();

        const fetchPage = async (url: string): Promise<string | null> => {
          try {
            const r = await fetch(url, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Marketoir/1.0)' },
              signal: AbortSignal.timeout(7000),
            });
            if (!r.ok) return null;
            return stripHtml(await r.text());
          } catch { return null; }
        };

        // Step 1: Scan homepage header/nav/footer for returns/refund links
        const discoveredReturnsPaths: string[] = [];
        const homepageHtml = await (async () => {
          try {
            const r = await fetch(base + '/', {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Marketoir/1.0)' },
              signal: AbortSignal.timeout(7000),
            });
            return r.ok ? await r.text() : '';
          } catch { return ''; }
        })();

        if (homepageHtml) {
          const regionMatches = homepageHtml.match(/<(?:header|nav|footer)[^>]*>[\s\S]*?<\/(?:header|nav|footer)>/gi) || [];
          const regionHtml = regionMatches.join(' ') || homepageHtml;
          const linkRegex = /href=["']([^"']+)["'][^>]*>([^<]*)</gi;
          let m: RegExpExecArray | null;
          while ((m = linkRegex.exec(regionHtml)) !== null) {
            const href = m[1];
            const label = m[2];
            if (RETURNS_KEYWORDS.test(href) || RETURNS_KEYWORDS.test(label)) {
              const path = href.startsWith('http')
                ? (new URL(href)).pathname
                : href.startsWith('/') ? href : '/' + href;
              if (!discoveredReturnsPaths.includes(path)) discoveredReturnsPaths.push(path);
            }
          }
        }

        // Step 2: Fallback candidates
        const returnsFallbacks = [
          '/policies/refund',
          '/pages/returns',
          '/pages/returns-policy',
          '/pages/refund-policy',
          '/pages/returns-and-exchanges',
          '/pages/returns-and-refunds',
          '/pages/returns-and-shipping',
          '/returns',
          '/refunds',
          '/return-policy',
          '/refund-policy',
        ];

        const seen = new Set<string>();
        const allReturnsCandidates = [...discoveredReturnsPaths, ...returnsFallbacks].filter(p => {
          if (seen.has(p)) return false;
          seen.add(p);
          return true;
        });

        for (const path of allReturnsCandidates) {
          const text = await fetchPage(base + path);
          if (text && text.length > 200) {
            returnsPageContent = text.slice(0, 4000);
            break;
          }
        }
      }

      const returnsContext = returnsPageContent
        ? `\nRETURNS POLICY PAGE CONTENT SCRAPED FROM THE BRAND WEBSITE:\n${returnsPageContent}\n\nSummarise the existing returns policy from the above content in a short, factual form (3-5 sentences max). Do NOT write or invent a policy — only condense what is already there. Include the return window, key conditions, and refund method if stated.`
        : '';

      // ── For brandHistory: scrape About page + social bios ────────────────
      let brandHistoryContent = '';
      if (fieldKey === 'brandHistory' && brandUrl) {
        const base = brandUrl.replace(/\/$/, '');

        const stripHtml = (html: string) =>
          html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();

        const fetchPage = async (url: string): Promise<string | null> => {
          try {
            const r = await fetch(url, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Marketoir/1.0)' },
              signal: AbortSignal.timeout(8000),
            });
            if (!r.ok) return null;
            return stripHtml(await r.text());
          } catch { return null; }
        };

        const ABOUT_KEYWORDS = /about|our.?story|who.?we.?are|history|brand.?story|founders?/i;

        // Step 1: Scan homepage for About-style links
        const discoveredAboutPaths: string[] = [];
        const homepageHtml = await (async () => {
          try {
            const r = await fetch(base + '/', {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Marketoir/1.0)' },
              signal: AbortSignal.timeout(7000),
            });
            return r.ok ? await r.text() : '';
          } catch { return ''; }
        })();

        if (homepageHtml) {
          const regionMatches = homepageHtml.match(/<(?:header|nav|footer)[^>]*>[\s\S]*?<\/(?:header|nav|footer)>/gi) || [];
          const regionHtml = regionMatches.join(' ') || homepageHtml;
          const linkRegex = /href=["']([^"']+)["'][^>]*>([^<]*)</gi;
          let m: RegExpExecArray | null;
          while ((m = linkRegex.exec(regionHtml)) !== null) {
            const href = m[1];
            const label = m[2];
            if (ABOUT_KEYWORDS.test(href) || ABOUT_KEYWORDS.test(label)) {
              const path = href.startsWith('http')
                ? (new URL(href)).pathname
                : href.startsWith('/') ? href : '/' + href;
              if (!discoveredAboutPaths.includes(path)) discoveredAboutPaths.push(path);
            }
          }
        }

        // Step 2: Fallback paths
        const aboutFallbacks = [
          '/pages/about',
          '/pages/about-us',
          '/pages/our-story',
          '/pages/brand-story',
          '/about',
          '/about-us',
          '/our-story',
        ];

        const seen = new Set<string>();
        const allAboutCandidates = [...discoveredAboutPaths, ...aboutFallbacks].filter(p => {
          if (seen.has(p)) return false;
          seen.add(p);
          return true;
        });

        const snippets: string[] = [];
        for (const path of allAboutCandidates) {
          const text = await fetchPage(base + path);
          if (text && text.length > 200) {
            snippets.push(`[From ${path}]:\n${text.slice(0, 3000)}`);
            break; // one About page is enough
          }
        }

        // Step 3: Also try to grab Instagram bio via homepage meta tags
        if (homepageHtml) {
          const igMatch = homepageHtml.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
          if (igMatch) {
            const igUser = igMatch[1];
            const igPage = await fetchPage(`https://www.instagram.com/${igUser}/`);
            if (igPage) {
              // Extract bio from og:description or meta description
              const bioMatch = homepageHtml.match(/<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([^"']{10,300})["']/i)
                            ?? igPage.match(/description["'][^>]*content=["']([^"']{10,300})["']/i);
              if (bioMatch?.[1]) snippets.push(`[Instagram @${igUser} bio]: ${bioMatch[1]}`);
            }
          }
          // Also grab homepage og:description as a fallback brand blurb
          const ogDesc = homepageHtml.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{20,500})["']/i)
                      ?? homepageHtml.match(/<meta[^>]+content=["']([^"']{20,500})["'][^>]+property=["']og:description["']/i);
          if (ogDesc?.[1]) snippets.push(`[Homepage og:description]: ${ogDesc[1]}`);
        }

        brandHistoryContent = snippets.join('\n\n');
      }

      const brandHistoryContext = brandHistoryContent
        ? `\nBRAND HISTORY SOURCE CONTENT (scraped from website and social media):\n${brandHistoryContent}\n\nUsing the above content, write a Brand History summary covering: when and where the brand was founded, who founded it, what inspired it, and any notable milestones or growth moments. Keep it factual and grounded in what was found — do not invent details. Write in 3-6 sentences in a warm, narrative tone.`
        : '';

      // ── For loyaltyProgram: scrape homepage menu/footer + loyalty pages ───
      let loyaltyProgramContent = '';
      if (fieldKey === 'loyaltyProgram' && brandUrl) {
        loyaltyProgramContent = await scrapeLoyaltyProgramContent(brandUrl);
      }

      const loyaltyProgramContext = loyaltyProgramContent
        ? `\nLOYALTY PROGRAM CONTENT (scraped from homepage/menu/footer and loyalty links):\n${loyaltyProgramContent}\n\nSummarise key loyalty program details only from the content above: program name, how points/rewards are earned, how redemption works, tiers/perks, and any noteworthy conditions. Keep it concise and factual. If details are missing, leave them out.`
        : '';

      // ── For physicalBranches: scrape store locator / contact pages ────────
      let physicalBranchesContent = '';
      if (fieldKey === 'physicalBranches' && brandUrl) {
        const base = brandUrl.replace(/\/$/, '');
        const STORE_KEYWORDS = /store|location|branch|find.?us|visit.?us|contact|stockist|showroom|outlet/i;
        // Keywords that suggest a link goes to an individual branch page
        const BRANCH_DETAIL_KEYWORDS = /store|location|branch|showroom|outlet|visit|shop/i;

        const stripHtml = (html: string) =>
          html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();

        const fetchRaw = async (url: string): Promise<string | null> => {
          try {
            const r = await fetch(url, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Marketoir/1.0)' },
              signal: AbortSignal.timeout(8000),
            });
            if (!r.ok) return null;
            return await r.text();
          } catch { return null; }
        };

        const fetchPage = async (url: string): Promise<string | null> => {
          const raw = await fetchRaw(url);
          return raw ? stripHtml(raw) : null;
        };

        // Step 1: Collect ALL nav/menu links from the homepage (not just header/footer)
        // This catches top-menu branch links like /pages/sydney-store etc.
        const allNavLinks: { path: string; label: string }[] = [];
        const homepageRaw = await fetchRaw(base + '/') ?? '';

        if (homepageRaw) {
          // Extract from entire page — branch links can be in mega-menus, dropdowns etc.
          const linkRegex = /href=["']([^"'#?][^"']*)["'][^>]*>([^<]{1,60})</gi;
          let m: RegExpExecArray | null;
          while ((m = linkRegex.exec(homepageRaw)) !== null) {
            const href = m[1].trim();
            const label = m[2].trim();
            if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
            try {
              const resolved = href.startsWith('http') ? new URL(href) : new URL(href, base);
              if (resolved.hostname !== new URL(base).hostname) continue; // external links only
              const path = resolved.pathname;
              if (allNavLinks.length < 200 && !allNavLinks.find(l => l.path === path)) {
                allNavLinks.push({ path, label });
              }
            } catch { /* skip malformed */ }
          }
        }

        // Step 2: From all nav links, pick those matching store/branch keywords
        const discoveredStorePaths: string[] = [];
        for (const { path, label } of allNavLinks) {
          if (STORE_KEYWORDS.test(path) || STORE_KEYWORDS.test(label)) {
            if (!discoveredStorePaths.includes(path)) discoveredStorePaths.push(path);
          }
        }

        const storeFallbacks = [
          '/pages/stores',
          '/pages/locations',
          '/pages/find-us',
          '/pages/store-locator',
          '/pages/contact',
          '/pages/visit-us',
          '/pages/our-stores',
          '/stores',
          '/locations',
          '/contact',
          '/contact-us',
        ];

        const seen = new Set<string>();
        const allStoreCandidates = [...discoveredStorePaths, ...storeFallbacks].filter(p => {
          if (seen.has(p)) return false;
          seen.add(p);
          return true;
        });

        const storeSnippets: string[] = [];

        for (const path of allStoreCandidates) {
          if (storeSnippets.length >= 6) break;
          const raw = await fetchRaw(base + path);
          if (!raw || raw.length < 200) continue;

          const text = stripHtml(raw);
          storeSnippets.push(`[From ${path}]:\n${text.slice(0, 4000)}`);

          // Step 3: Follow links within this page that look like individual branch pages
          const subLinkRegex = /href=["']([^"'#?][^"']*)["'][^>]*>([^<]{1,60})</gi;
          const subPaths: string[] = [];
          let sm: RegExpExecArray | null;
          while ((sm = subLinkRegex.exec(raw)) !== null) {
            const href = sm[1].trim();
            const label = sm[2].trim();
            try {
              const resolved = href.startsWith('http') ? new URL(href) : new URL(href, base);
              if (resolved.hostname !== new URL(base).hostname) continue;
              const subPath = resolved.pathname;
              if (
                subPath !== path &&
                !seen.has(subPath) &&
                (BRANCH_DETAIL_KEYWORDS.test(subPath) || BRANCH_DETAIL_KEYWORDS.test(label))
              ) {
                subPaths.push(subPath);
                seen.add(subPath);
              }
            } catch { /* skip */ }
          }

          // Fetch up to 5 individual branch sub-pages
          for (const subPath of subPaths.slice(0, 5)) {
            if (storeSnippets.length >= 6) break;
            const subText = await fetchPage(base + subPath);
            if (subText && subText.length > 200) {
              storeSnippets.push(`[From ${subPath}]:\n${subText.slice(0, 3000)}`);
            }
          }
        }

        physicalBranchesContent = storeSnippets.join('\n\n');
      }

      const physicalBranchesContext = physicalBranchesContent
        ? `\nSTORE LOCATIONS CONTENT (scraped from multiple pages on the website):\n${physicalBranchesContent}\n\nExtract every physical branch/store found across all the above pages. For each branch provide: branch name, full street address, phone number, and opening hours (all days listed). Format as a clear structured list with one branch per block separated by a blank line. Only include real details found in the scraped content — do not invent or guess anything. If a detail is not found, omit it rather than guessing.`
        : '';

      // ── For connectedSoftware: read live Connections ──
      let fieldConnectionsContext = '';
      if (fieldKey === 'connectedSoftware' && databaseId) {
        fieldConnectionsContext = await buildConnectionsContext(databaseId);
      }
      const connectionsContextBlock = fieldConnectionsContext
        ? `\n${fieldConnectionsContext}\n\nFor the connectedSoftware field, translate the column names above into human-readable software names (e.g. Cin7AccountId → Cin7 Omni, ShopifyShopId → Shopify, GA4PropertyId → Google Analytics (GA4), GoogleAdsCustomerId → Google Ads, MetaAdAccountId → Meta Ads). Only include platforms that have values set. Return as a comma-separated string.`
        : '';

      const fieldPrompt = `You are a brand strategist. Regenerate ONLY the "${fieldKey}" field for the brand "${brandName}".

EXISTING PROFILE CONTEXT (for reference only — do not return these, only return the one field asked):
${JSON.stringify(existingProfile, null, 2)}
${shippingContext}${returnsContext}${brandHistoryContext}${physicalBranchesContext}${loyaltyProgramContext}${connectionsContextBlock}

Return a JSON object with ONLY the key "${fieldKey}" and its new value. No other keys, no markdown, no explanation.
Example: { "${fieldKey}": "new value here" }`;

      const ai = new GoogleGenAI({ apiKey });
      const resp = await ai.models.generateContent({ model: modelId, contents: fieldPrompt });
      const raw = resp.text?.trim() ?? '';
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      try {
        const result = JSON.parse(cleaned);
        return NextResponse.json({ success: true, profile: result });
      } catch {
        return NextResponse.json({ error: 'AI returned unexpected format for field regeneration.' }, { status: 500 });
      }
    }

    if (!brandName) {
      return NextResponse.json({ error: 'Missing brand name.' }, { status: 400 });
    }
    if (!isRefine && !brandUrl) {
      return NextResponse.json({ error: 'Missing Brand URL to analyze.' }, { status: 400 });
    }
    if (isRefine && (!existingProfile || !userComments?.trim())) {
      return NextResponse.json({ error: 'Missing existing profile or user comments for refinement.' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API key not configured.' }, { status: 500 });
    }

    // ── 1. Look up configured Gemini model + inventory system ID ───────────
    let modelId = 'gemini-2.5-pro-preview';
    let inventorySystemId = databaseId;
    if (databaseId) {
      try {
        const conn = await ConnectionsRepository.get(databaseId).catch(() => null);
        if (conn?.gemini_model) modelId = conn.gemini_model;
        inventorySystemId = await resolveInventorySystemId(databaseId).catch(() => databaseId);
      } catch { /* use defaults */ }
    }

    // ── 2. Build connections context for AI ──────────────────────────────────
    const connectionsContext = databaseId
      ? await buildConnectionsContext(databaseId)
      : '';

    // ── 3. Load sales summary (from inventory system) ──────────
    let salesContext = '';
    if (databaseId) {
      const sales = await loadSalesSummary(inventorySystemId);
      if (sales) {
        const heroList = sales.heroProducts
          .map((p, i) => `  ${i + 1}. ${p.name} — $${p.revenue.toFixed(0)} revenue, ${p.qty} units`)
          .join('\n');
        salesContext = `
REAL SALES DATA (from Cin7 — use this for hero products and pricing fields):
- Total products with sales: ${sales.productCount}
- Total orders: ${sales.totalOrders}
- Total revenue: $${sales.totalRevenue.toFixed(0)}
- Average Order Value (AOV): $${sales.aov.toFixed(2)}
- Top ${sales.heroProducts.length} hero products by revenue (top 5% of catalogue):
${heroList}
`.trim();
      }
    }

    let loyaltyProgramContext = '';
    if (!isRefine && brandUrl) {
      const loyaltyProgramContent = await scrapeLoyaltyProgramContent(brandUrl);
      if (loyaltyProgramContent) {
        loyaltyProgramContext = `\nLOYALTY PROGRAM CONTENT (scraped from homepage/menu/footer and loyalty links):\n${loyaltyProgramContent}\n\nUse this to populate the loyaltyProgram field with a concise factual summary of the program name, earn mechanics, redemption mechanics, tiers/perks, and key conditions.`;
      }
    }

    // ── 4. Auto-detect logo URL if no image uploaded (fresh generation only) ─
    let detectedLogoUrl: string | null = null;
    if (!isRefine && !logoBase64 && brandUrl) {
      detectedLogoUrl = await fetchLogoFromWebsite(brandUrl);
    }

    // ── 5. Fetch logo image bytes if we only have a URL (for colour vision) ─
    let effectiveLogoBase64 = logoBase64 ?? null;
    let effectiveMimeType   = logoMimeType ?? 'image/jpeg';

    if (!effectiveLogoBase64 && detectedLogoUrl) {
      try {
        const imgRes = await fetch(detectedLogoUrl, { signal: AbortSignal.timeout(6_000) });
        if (imgRes.ok) {
          const buf = await imgRes.arrayBuffer();
          effectiveLogoBase64 = Buffer.from(buf).toString('base64');
          const ct = imgRes.headers.get('content-type') ?? 'image/jpeg';
          effectiveMimeType = ct.split(';')[0].trim();
        }
      } catch { /* proceed without logo image */ }
    }

    // ── 6. Build Gemini request ─────────────────────────────────────────────────
    const ai = new GoogleGenAI({ apiKey });
    const basePrompt = isRefine
      ? REFINE_PROMPT(brandName, existingProfile, userComments, salesContext, connectionsContext, !!effectiveLogoBase64)
      : PROMPT(brandName, brandUrl, salesContext, connectionsContext, !!effectiveLogoBase64);
    const promptText = `${basePrompt}${loyaltyProgramContext}`;

    const contents: any = effectiveLogoBase64
      ? [{ role: 'user', parts: [
          { text: promptText },
          { inlineData: { mimeType: effectiveMimeType, data: effectiveLogoBase64 } },
        ]}]
      : promptText;

    const response = await ai.models.generateContent({ model: modelId, contents });
    const text = response.text?.trim() ?? '';
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let profile: Record<string, any>;
    try {
      profile = JSON.parse(cleaned);
    } catch {
      console.error('Gemini returned non-JSON:', text);
      return NextResponse.json({ error: 'AI returned an unexpected format. Please try again.' }, { status: 500 });
    }

    // Ensure logoUrl falls back to what we auto-detected
    if (!profile.logoUrl && detectedLogoUrl) {
      profile.logoUrl = detectedLogoUrl;
    }

    // Normalise brandColours: ensure it's an object with all 5 role keys
    const COLOUR_KEYS = ['primary', 'secondary', 'accent', 'neutral', 'background'] as const;
    if (typeof profile.brandColours !== 'object' || Array.isArray(profile.brandColours) || !profile.brandColours) {
      // Legacy fallback: AI returned an array or flat string
      const arr: string[] = Array.isArray(profile.brandColours)
        ? profile.brandColours
        : typeof profile.brandColours === 'string'
          ? profile.brandColours.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [];
      const obj: Record<string, string> = {};
      COLOUR_KEYS.forEach((k, i) => { obj[k] = arr[i] ?? ''; });
      profile.brandColours = obj;
    }
    // Fill any missing keys with empty string
    COLOUR_KEYS.forEach(k => { if (!profile.brandColours[k]) profile.brandColours[k] = ''; });

    if (!profile.connectedSoftware) profile.connectedSoftware = '';
    if (!profile.loyaltyProgram) profile.loyaltyProgram = '';

    return NextResponse.json({ success: true, profile });

  } catch (error: any) {
    console.error('AI Profile Generation error:', error);
    return NextResponse.json({ error: 'Failed to generate profile via AI.' }, { status: 500 });
  }
}
