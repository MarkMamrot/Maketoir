import { NextResponse } from 'next/server';

import { OnlineShopDomainRepository } from '@/lib/onlineShop/onlineShopDomain';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';

export async function GET(request: Request) {
  const host = new URL(request.url).searchParams.get('host');
  const businessId = await OnlineShopDomainRepository.getActiveBusinessId(host);
  if (!businessId) return NextResponse.json({ error: 'Store domain not found.' }, { status: 404 });
  const profile = await OnlineShopProfileRepository.getByBusinessId(businessId);
  if (!profile?.isActive) return NextResponse.json({ error: 'Store domain not found.' }, { status: 404 });
  return NextResponse.json({ slug: profile.slug }, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } });
}