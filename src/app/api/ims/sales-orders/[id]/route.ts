import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { triggerSOXeroSync } from '@/lib/ims/xeroHooks';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const data = await ImsSORepo.get(Number(params.id));
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
    const { items, status, ...soData } = body;

    if (status) {
      await ImsSORepo.changeStatus(Number(params.id), status);
      
      // EVENT-DRIVEN CACHE UPDATE: Refresh cache for variant sales logic when order becomes fulfilled or changes state.
      // We retrieve the SO items to know which variants are affected.
      const soDataFull = await ImsSORepo.get(Number(params.id));
      if (soDataFull && (soDataFull.items?.length ?? 0) > 0) {
        const vids = soDataFull.items!.map(i => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for SO:', err));
        }
      }

      // Fire-and-forget Xero sync on SO status change (confirmed → invoice)
      const session = getSession();
      if (session?.userSpreadsheetId) {
        triggerSOXeroSync(session.userSpreadsheetId, Number(params.id), status).catch(() => {});
      }

    } else {
      await ImsSORepo.update(Number(params.id), soData, items);
      
      // EVENT-DRIVEN CACHE UPDATE
      if (items && items.length > 0) {
        const vids = items.map((i: any) => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for SO:', err));
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
    const existing = await ImsSORepo.get(Number(params.id));
    await ImsSORepo.delete(Number(params.id));

    // EVENT-DRIVEN CACHE UPDATE (Deletion reverses committed stock & sales)
    if (existing && (existing.items?.length ?? 0) > 0) {
      const vids = existing.items!.map(i => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for SO deletion:', err));
      }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
