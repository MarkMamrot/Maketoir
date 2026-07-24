import { NextRequest, NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsCNRepo } from '@/lib/ims/ImsRepository';

function normalizeAndValidateCNItems(rawItems: any[]) {
  const items = (rawItems ?? []).map((item: any) => ({
    ...item,
    qty: Math.abs(Number(item?.qty ?? 0)),
    unit_price: Math.abs(Number(item?.unit_price ?? 0)),
    tax_rate: Math.abs(Number(item?.tax_rate ?? 0)),
  }));

  if (!items.length) {
    return { items: [], error: 'Please add at least one line item.' };
  }

  if (items.some((item: any) => !(item.qty > 0))) {
    return { items: [], error: 'Credit note quantities cannot be 0. You can enter positive or negative values; the system auto-converts to positive.' };
  }

  return { items, error: null as string | null };
}


export async function GET(req: NextRequest) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const status = req.nextUrl.searchParams.get('status') as 'draft' | 'complete' | undefined ?? undefined;
    const data = await ImsCNRepo.list(businessId, status || undefined);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const body = await req.json();
    const { items, ...data } = body;
    const normalized = normalizeAndValidateCNItems(items ?? []);
    if (normalized.error) {
      return NextResponse.json({ success: false, error: normalized.error }, { status: 400 });
    }
    const id = await ImsCNRepo.create(data, normalized.items, businessId, session.username ?? undefined);
    const cn = await ImsCNRepo.get(id, businessId);
    return NextResponse.json({ success: true, data: cn });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
