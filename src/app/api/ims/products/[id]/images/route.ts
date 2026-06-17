import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsImagesRepo } from '@/lib/ims/ImsRepository';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

/** GET /api/ims/products/[id]/images */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const data = await ImsImagesRepo.list(params.id);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/ims/products/[id]/images
 * Body: { url: string, source?: 'shopify'|'google_drive'|'external', alt_text?: string, is_primary?: boolean }
 * Add an image by URL (no file upload — use /images/upload for that).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const { url, source = 'external', alt_text, is_primary } = await req.json();
    if (!url) return NextResponse.json({ success: false, error: 'url required' }, { status: 400 });
    const id = await ImsImagesRepo.add(params.id, url, source, { altText: alt_text, isPrimary: !!is_primary });
    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * PATCH /api/ims/products/[id]/images
 * Body: { action: 'set_primary', image_id: number }
 *    or { action: 'reorder', ordered_ids: number[] }
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json();
    if (body.action === 'set_primary') {
      await ImsImagesRepo.setPrimary(Number(body.image_id), params.id);
    } else if (body.action === 'reorder') {
      await ImsImagesRepo.reorder(params.id, body.ordered_ids);
    } else {
      return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * DELETE /api/ims/products/[id]/images?imageId=123
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const imageId = Number(new URL(req.url).searchParams.get('imageId'));
    if (!imageId) return NextResponse.json({ success: false, error: 'imageId required' }, { status: 400 });
    await ImsImagesRepo.delete(imageId, params.id);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
