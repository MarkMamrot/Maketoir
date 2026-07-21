import { NextResponse } from 'next/server';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { getImsSession } from '@/lib/auth/imsSession';

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') as any ?? undefined;
    const data = await ImsSORepo.list(status, businessId);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  try {
    const body = await req.json();
    const { items, ...soData } = body;
    const id = await ImsSORepo.create(soData, items ?? [], businessId);

    // EVENT-DRIVEN CACHE UPDATE (Creation affects committed stock)
    if (items && items.length > 0) {
      const vids = items.map((i: any) => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for SO creation:', err));
      }
    }

    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
