import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';


export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const conn = await ConnectionsRepository.get(session.businessId);
    const connected = !!(conn?.shopify_shop_id && conn?.shopify_access_token);
    const counts = await ImsShopifyRepo.getCounts(session.businessId);
    return NextResponse.json({
      success: true,
      connected,
      shop_domain: conn?.shopify_shop_id ?? null,
      ...counts,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
