import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';


export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const disabled = await shopifyDisabledResponse(session.businessId); if (disabled) return disabled;
  try {
    const conn = await ConnectionsRepository.get(session.businessId);
    const connected = conn?.shopify_auth_mode === 'client_credentials'
      ? Boolean(conn.shopify_shop_id && conn.shopify_client_id && conn.shopify_client_secret)
      : Boolean(conn?.shopify_shop_id && conn.shopify_access_token);
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
