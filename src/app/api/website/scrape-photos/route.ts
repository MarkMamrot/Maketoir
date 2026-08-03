import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { extractProductPageImages } from '@/lib/website/productPageImages';

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

    // Prefer the approved page's own product gallery. This excludes recommendation
    // carousels and other products that broad image extraction commonly returns.
    for (const rawUrl of urls) {
      try {
        const pageRes = await fetch(rawUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!pageRes.ok) {
          failedUrls.push(rawUrl);
          continue;
        }
        const images = extractProductPageImages(await pageRes.text(), rawUrl);
        if (images.length === 0) failedUrls.push(rawUrl);
        images.forEach(image => uniqueImages.add(image));
      } catch (e: any) {
        console.warn(`[scrape-photos] Direct fetch failed for ${rawUrl}:`, e.message);
        failedUrls.push(rawUrl);
      }
    }

    // Tavily is a fallback for pages the direct structured-gallery pass cannot read.
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey && failedUrls.length > 0) {
      try {
        const tavilyRes = await fetch('https://api.tavily.com/extract', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tavilyKey}`,
          },
          body: JSON.stringify({ urls: failedUrls, include_images: true }),
          signal: AbortSignal.timeout(30000),
        });

        if (tavilyRes.ok) {
          const tavilyJson = await tavilyRes.json();
          const results: any[] = tavilyJson.results ?? [];
          const failed: any[] = tavilyJson.failed_results ?? [];

          // Broad Tavily image lists include recommendations and page chrome.
          // Only page content with structured product evidence is trusted.
          for (const result of results) {
            if (result.raw_content && result.url) {
              const trusted = extractProductPageImages(result.raw_content, result.url);
              trusted.forEach(image => uniqueImages.add(image));
            }
          }

          // Queue any URLs Tavily couldn't fetch for direct fallback
          for (const f of failed) console.warn(`[scrape-photos] Tavily could not extract ${f.url ?? 'page'}`);
        }
      } catch (e: any) {
        console.warn('[scrape-photos] Tavily Extract error:', e.message);
      }
    }

    return NextResponse.json({ images: [...uniqueImages].slice(0, 6) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Unexpected error' }, { status: 500 });
  }
}
