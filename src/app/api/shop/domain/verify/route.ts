import { NextResponse } from 'next/server';

import { OnlineShopDomainRepository } from '@/lib/onlineShop/onlineShopDomain';

function requestHost(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('host')?.trim() || new URL(request.url).hostname;
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  const verified = await OnlineShopDomainRepository.matchesVerificationToken(requestHost(request), token);
  return NextResponse.json({ verified }, { status: verified ? 200 : 404, headers: { 'Cache-Control': 'no-store' } });
}