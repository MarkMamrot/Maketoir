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

// GET /api/pos/products/images
// Returns { images: { [product_id]: url } }
// Intended to be called once and cached client-side for up to 24 h.
export async function GET() {
  const posSession   = getPosSession();
  const adminSession = getAdminSession();
  const session      = posSession ?? adminSession;
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session', 'marketoir_session']);

  const rows = await imsQuery<{ product_id: string; image_url: string }>(
    `SELECT product_id, url AS image_url
     FROM (
       SELECT product_id, url,
              ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY is_primary DESC, sort_order ASC) AS rn
       FROM ims_product_images
     ) t
     WHERE rn = 1`,
  );

  const images: Record<string, string> = {};
  for (const r of rows) images[r.product_id] = r.image_url;

  return NextResponse.json({ images });
}
