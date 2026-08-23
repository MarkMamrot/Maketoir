import { NextResponse } from 'next/server';
import { ONLINE_SHOP_SESSION_COOKIE } from '@/lib/onlineShop/onlineShopSession';

export async function POST(_: Request, { params }: { params: { slug: string } }) {
  const response = NextResponse.json({ success: true, nextRoute: `/shop/${params.slug}` });
  response.cookies.set(ONLINE_SHOP_SESSION_COOKIE, '', { httpOnly: true, expires: new Date(0), path: '/' });
  return response;
}