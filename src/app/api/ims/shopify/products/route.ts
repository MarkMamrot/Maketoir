import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';


export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const products = await ImsShopifyRepo.listWithShopifyStatus(session.businessId);
    return NextResponse.json({ success: true, data: products });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
