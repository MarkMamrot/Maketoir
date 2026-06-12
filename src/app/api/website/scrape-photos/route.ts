import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const IMAGE_NOISE = ['thumb', 'icon', 'swatch', 'logo', 'favicon', 'width=160', 'width=100', 'width=50'];

function isUsableImage(url: string) {
  return !IMAGE_NOISE.some(n => url.includes(n));
}

/** Fix double-slashes in paths (from JSON-escaped \/ sequences) and stray backslashes. */
function normalizeImageUrl(url: string): string {
  // Unescape JSON-escaped forward slashes (\/ → /)
  let u = url.replace(/\\\//g, '/');
  // Collapse any // (or more) in the path — but preserve the https:// or http:// at the start
  u = u.replace(/([^:])\/{2,}/g, '$1/');
  return u;
}

function extractImagesFromHtml(html: string, uniqueImages: Set<string>) {
  // og:image — handles both attribute orders and multiline tags
  const og = html.match(/property=["']og:image["'][\s\S]{0,200}?content=["']([^"']+)["']/i)
    ?? html.match(/content=["']([^"']+)["'][\s\S]{0,200}?property=["']og:image["']/i);
  if (og?.[1]) uniqueImages.add(og[1]);

  // twitter:image
  const tw = html.match(/(?:name|property)=["']twitter:image["'][\s\S]{0,200}?content=["']([^"']+)["']/i)
    ?? html.match(/content=["']([^"']+)["'][\s\S]{0,200}?(?:name|property)=["']twitter:image["']/i);
  if (tw?.[1]) uniqueImages.add(tw[1]);

  // Magento/JSON gallery: "img":"https://..."
  for (const m of html.matchAll(/"img":"([^"]+\.(?:jpg|jpeg|png|webp))"/gi)) {
    const imgUrl = normalizeImageUrl(m[1].replace(/\\u002F/g, '/'));
    if (isUsableImage(imgUrl)) uniqueImages.add(imgUrl);
  }

  // Raw URL sweep
  const rawMatches = html.match(/(?:https?:)?\/\/[^"'\s<>]+?\.(?:jpg|jpeg|png|webp)/gi) ?? [];
  for (let imgUrl of rawMatches) {
    let fullUrl = imgUrl.startsWith('//') ? `https:${imgUrl}` : imgUrl;
    fullUrl = normalizeImageUrl(fullUrl);
    if (!isUsableImage(fullUrl)) continue;
    fullUrl = fullUrl.replace(/_[0-9]+x[0-9]*\.(jpg|png|webp)/i, '.$1');
    uniqueImages.add(fullUrl);
    if (uniqueImages.size >= 10) break;
  }
}

/**
 * POST /api/website/scrape-photos
 *
 * Scrapes up to 10 product images from the provided URLs.
 * Uses Tavily Extract API first (bypasses Cloudflare / bot protection),
 * then falls back to a direct fetch for any URLs Tavily cannot handle.
 * Returns { images: string[] } — absolute image URLs.
 */
export async function POST(req: Request) {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const body = await req.json();
    const urls: string[] = (body.urls ?? []).filter((u: any) => typeof u === 'string' && u.startsWith('http'));

    if (urls.length === 0) {
      return NextResponse.json({ images: [] });
    }

    const uniqueImages = new Set<string>();
    const failedUrls: string[] = [];

    // --- Strategy 1: Tavily Extract (handles Cloudflare-protected sites) ---
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      try {
        const tavilyRes = await fetch('https://api.tavily.com/extract', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tavilyKey}`,
          },
          body: JSON.stringify({ urls, include_images: true }),
          signal: AbortSignal.timeout(30000),
        });

        if (tavilyRes.ok) {
          const tavilyJson = await tavilyRes.json();
          const results: any[] = tavilyJson.results ?? [];
          const failed: any[] = tavilyJson.failed_results ?? [];

          // Collect images Tavily found directly
          for (const result of results) {
            for (const imgUrl of (result.images ?? [])) {
              if (typeof imgUrl === 'string') {
                const norm = normalizeImageUrl(imgUrl);
                if (isUsableImage(norm)) uniqueImages.add(norm);
              }
            }
            // Also parse the raw_content Tavily returned
            if (result.raw_content) {
              extractImagesFromHtml(result.raw_content, uniqueImages);
            }
          }

          // Queue any URLs Tavily couldn't fetch for direct fallback
          for (const f of failed) {
            if (f.url) failedUrls.push(f.url);
          }
        } else {
          // Tavily extract failed — fall back to direct fetch for all urls
          failedUrls.push(...urls);
        }
      } catch (e: any) {
        console.warn('[scrape-photos] Tavily Extract error:', e.message);
        failedUrls.push(...urls);
      }
    } else {
      failedUrls.push(...urls);
    }

    // --- Strategy 2: Direct fetch fallback for any URLs Tavily couldn't handle ---
    for (const rawUrl of failedUrls) {
      if (uniqueImages.size >= 10) break;
      try {
        const pageRes = await fetch(rawUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          signal: AbortSignal.timeout(8000),
        });

        if (!pageRes.ok) continue;
        const html = await pageRes.text();
        extractImagesFromHtml(html, uniqueImages);
      } catch (e: any) {
        console.warn(`[scrape-photos] Direct fetch failed for ${rawUrl}:`, e.message);
      }
    }

    return NextResponse.json({ images: [...uniqueImages].slice(0, 6) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unexpected error' }, { status: 500 });
  }
}
