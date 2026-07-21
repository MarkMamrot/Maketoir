import { NextResponse } from 'next/server';
import { ImsBTRepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { getImsSession } from '@/lib/auth/imsSession';

const IMS_OR_POS_SESSION = ['marketoir_session', 'pos_session'];

export async function GET(req: Request) {
  if (!await getImsSession(IMS_OR_POS_SESSION)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');
    const status = statusParam
      ? (statusParam.includes(',') ? statusParam.split(',') as any[] : statusParam as any)
      : undefined;
    const data = await ImsBTRepo.list(status);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!await getImsSession(IMS_OR_POS_SESSION)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json();
    const { items, ...btData } = body;
    const id = await ImsBTRepo.create(btData, items ?? []);

    // EVENT-DRIVEN CACHE UPDATE (Creation affects committed stock)
    if (items && items.length > 0) {
      const vids = items.map((i: any) => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for BT creation:', err));
      }
    }

    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
