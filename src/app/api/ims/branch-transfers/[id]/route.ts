import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsBTRepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const data = await ImsBTRepo.get(Number(params.id));
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
    const { items, status, receivedItems, ...btData } = body;
    if (status) {
      await ImsBTRepo.changeStatus(Number(params.id), status, receivedItems);
      
      // EVENT-DRIVEN CACHE UPDATE: Refresh for branch transfer transition
      // Though global_soh generally stays the same in BTs, transitioning to sent/received updates committed vs available stock
      const btDataFull = await ImsBTRepo.get(Number(params.id));
      if (btDataFull && (btDataFull.items?.length ?? 0) > 0) {
        const vids = btDataFull.items!.map(i => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for BT:', err));
        }
      }

    } else {
      await ImsBTRepo.update(Number(params.id), btData, items);

      // EVENT-DRIVEN CACHE UPDATE
      if (items && items.length > 0) {
        const vids = items.map((i: any) => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for BT:', err));
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
    const existing = await ImsBTRepo.get(Number(params.id));
    await ImsBTRepo.delete(Number(params.id));

    // EVENT-DRIVEN CACHE UPDATE (Deletion reverses committed transfer stock)
    if (existing && (existing.items?.length ?? 0) > 0) {
      const vids = existing.items!.map(i => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for BT deletion:', err));
      }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
