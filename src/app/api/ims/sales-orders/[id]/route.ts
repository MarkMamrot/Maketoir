import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { triggerSOXeroSync, triggerSOXeroVoid } from '@/lib/ims/xeroHooks';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsSORepo.get(Number(params.id), businessId);
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const body = await req.json();
    const { items, status, ...soData } = body;

    let xeroWarning: string | null = null;
    if (status) {
      const existing = await ImsSORepo.get(Number(params.id), businessId);
      if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
      await ImsSORepo.changeStatus(Number(params.id), status);

      // EVENT-DRIVEN CACHE UPDATE
      if ((existing.items?.length ?? 0) > 0) {
        const vids = existing.items!.map(i => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for SO:', err));
        }
      }

      // Await void for revert/cancel so warning can be returned; fire-and-forget for other transitions
      if (status === 'draft' || status === 'cancelled') {
        xeroWarning = await triggerSOXeroVoid(businessId, Number(params.id)).catch(() => null);
      } else {
        triggerSOXeroSync(businessId, Number(params.id), status).catch(() => {});
      }

    } else {
      const existing = await ImsSORepo.get(Number(params.id), businessId);
      if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
      await ImsSORepo.update(Number(params.id), soData, items);

      // EVENT-DRIVEN CACHE UPDATE
      if (items && items.length > 0) {
        const vids = items.map((i: any) => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for SO:', err));
        }
      }
    }
    return NextResponse.json({ success: true, ...(xeroWarning ? { xeroWarning } : {}) });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const existing = await ImsSORepo.get(Number(params.id), businessId);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    // Void the Xero invoice before deleting (if one exists)
    const xeroWarning = await triggerSOXeroVoid(businessId, Number(params.id)).catch(() => null);

    await ImsSORepo.delete(Number(params.id));

    // EVENT-DRIVEN CACHE UPDATE (Deletion reverses committed stock & sales)
    if (existing && (existing.items?.length ?? 0) > 0) {
      const vids = existing.items!.map(i => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for SO deletion:', err));
      }
    }

    return NextResponse.json({ success: true, ...(xeroWarning ? { xeroWarning } : {}) });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
