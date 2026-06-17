import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const conn = await ConnectionsRepository.get(session.userSpreadsheetId);
    const connected = !!(conn?.shopify_shop_id && conn?.shopify_access_token);
    const counts = await ImsShopifyRepo.getCounts();
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
