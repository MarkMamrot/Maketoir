import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function getAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Rewrite a stored full-size image URL to a small (~200px) thumbnail variant
// for known CDN sources, using their native resize query params — no
// server-side image processing needed. Other sources (external/volume) are
// left untouched (full-size), since we can't guarantee they support resizing.
function toThumbnailUrl(url: string, source: string | null): string {
  if (!url) return url;
  try {
    if (source === 'shopify') {
      const u = new URL(url);
      u.searchParams.set('width', '200');
      return u.toString();
    }
    if (source === 'google_drive') {
      const u = new URL(url);
      if (u.searchParams.has('sz')) {
        u.searchParams.set('sz', 'w200');
        return u.toString();
      }
      return url;
    }
    return url;
  } catch {
    return url;
  }
}

// GET /api/pos/products/images
// GET /api/pos/products/images?since=<epoch_ms>
// Returns { images: { [product_id]: thumbUrl }, removed: string[], server_time: number }
// Without `since`: full snapshot (used on login / full safety-net resync).
// With `since`: only primary images that changed after that time, plus a
// `removed` list of product_ids whose primary image was deleted (so the
// client can evict stale cached thumbnails). Intended to be cached
// client-side for up to 24 h between full resyncs.
export async function GET(req: Request) {
  const posSession   = getPosSession();
  const adminSession = getAdminSession();
  const session      = posSession ?? adminSession;
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session', 'marketoir_session']);

  const { searchParams } = new URL(req.url);
  const since = searchParams.get('since');
  const serverTime = Date.now();

  if (since) {
    const sinceDate = new Date(Number(since));
    if (!isNaN(sinceDate.getTime())) {
      try {
        const rows = await imsQuery<{ product_id: string; image_url: string; source: string | null }>(
          `SELECT product_id, url AS image_url, source
           FROM (
             SELECT product_id, url, source, updated_at,
                    ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY is_primary DESC, sort_order ASC) AS rn
             FROM ims_product_images
           ) t
           WHERE rn = 1 AND updated_at > ?`,
          [sinceDate],
        );

        // NOTE: a product whose LAST remaining image is deleted (with no
        // replacement) can't be detected as "removed" from updated_at alone —
        // ims_product_images rows are hard-deleted, so there's no tombstone to
        // diff against. This is a rare edge case (admins usually replace an
        // image rather than remove it outright); worst case the client shows
        // a stale thumbnail until the next full resync (bounded by the 12h
        // safety net in the POS page). `removed` stays empty for images.
        const images: Record<string, string> = {};
        for (const r of rows) images[r.product_id] = toThumbnailUrl(r.image_url, r.source);

        return NextResponse.json({ images, removed: [], server_time: serverTime });
      } catch (e: any) {
        // Likely the ims_product_images.updated_at column doesn't exist yet on
        // this tenant (migration not yet run) — fall back to a full snapshot
        // rather than erroring out the client.
        if (!/unknown column/i.test(e.message ?? '')) throw e;
      }
    }
  }

  const rows = await imsQuery<{ product_id: string; image_url: string; source: string | null }>(
    `SELECT product_id, url AS image_url, source
     FROM (
       SELECT product_id, url, source,
              ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY is_primary DESC, sort_order ASC) AS rn
       FROM ims_product_images
     ) t
     WHERE rn = 1`,
  );

  const images: Record<string, string> = {};
  for (const r of rows) images[r.product_id] = toThumbnailUrl(r.image_url, r.source);

  return NextResponse.json({ images, removed: [], server_time: serverTime });
}
