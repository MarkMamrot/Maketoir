import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsBTRepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';

function getSession() {
  const raw = cookies().get('marketoir_session')?.value ?? cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function GET(req: Request) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
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
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
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
