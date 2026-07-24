import { NextRequest, NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSupplierCNRepo } from '@/lib/ims/ImsRepository';

function normalizeAndValidateSupplierCNItems(items: any[] | undefined): { items: any[]; error: string | null } {
  if (!Array.isArray(items) || items.length === 0) {
    return { items: [], error: 'Please add at least one line item.' };
  }
  const normalized = items.map(item => ({
    ...item,
    qty: Math.abs(Number(item?.qty)),
    unit_cost: Math.abs(Number(item?.unit_cost)),
    tax_rate: Math.abs(Number(item?.tax_rate ?? 0)),
    restock: item?.restock === undefined ? true : !!item?.restock,
  }));
  for (const item of normalized) {
    if (!(Number(item?.qty) > 0)) {
      return { items: [], error: 'Supplier credit note quantities cannot be 0. You can enter positive or negative values; the system auto-converts to positive.' };
    }
  }
  return { items: normalized, error: null };
}


export async function GET(req: NextRequest) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const status = req.nextUrl.searchParams.get('status') as 'draft' | 'complete' | 'cancelled' | undefined ?? undefined;
    const data = await ImsSupplierCNRepo.list(businessId, status || undefined);
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
    const normalized = normalizeAndValidateSupplierCNItems(items);
    if (normalized.error) {
      return NextResponse.json({ success: false, error: normalized.error }, { status: 400 });
    }
    const id = await ImsSupplierCNRepo.create(data, normalized.items, businessId, session.username ?? undefined);
    const scn = await ImsSupplierCNRepo.get(id, businessId);
    return NextResponse.json({ success: true, data: scn });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
