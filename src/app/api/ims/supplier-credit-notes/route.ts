import { NextRequest, NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSupplierCNRepo } from '@/lib/ims/ImsRepository';


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
    const id = await ImsSupplierCNRepo.create(data, items ?? [], businessId, session.username ?? undefined);
    const scn = await ImsSupplierCNRepo.get(id, businessId);
    return NextResponse.json({ success: true, data: scn });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
