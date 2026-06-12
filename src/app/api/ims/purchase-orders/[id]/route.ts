import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsPORepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const data = await ImsPORepo.get(Number(params.id));
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json();
    const { items, status, ...poData } = body;

    // Handle status transition
    if (status) {
      await ImsPORepo.changeStatus(Number(params.id), status);

      // EVENT-DRIVEN CACHE UPDATE: update global_incoming and stock fields on PO changes
      const poDataFull = await ImsPORepo.get(Number(params.id));
      if (poDataFull && poDataFull.items?.length > 0) {
        const vids = poDataFull.items.map(i => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for PO:', err));
        }
      }

    } else {
      await ImsPORepo.update(Number(params.id), poData, items);

      // EVENT-DRIVEN CACHE UPDATE
      if (items && items.length > 0) {
        const vids = items.map((i: any) => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for PO:', err));
        }
      }
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const existing = await ImsPORepo.get(Number(params.id));
    await ImsPORepo.delete(Number(params.id));

    // EVENT-DRIVEN CACHE UPDATE (Deletion reverses incoming stock)
    if (existing && existing.items?.length > 0) {
      const vids = existing.items.map(i => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for PO deletion:', err));
      }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
