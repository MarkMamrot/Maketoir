import { NextResponse } from 'next/server';

import { OnlineShopStripeConnectionRepository } from '@/lib/onlineShop/stripeConnect';
import { requireAdminTier } from '@/lib/sessionUtils';

export async function GET() {
  const auth = requireAdminTier(); if (auth.response) return auth.response;
  return NextResponse.json({ success: true, connection: await OnlineShopStripeConnectionRepository.get(auth.user.businessId),
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ? 'configured' : 'missing' });
}

export async function DELETE() {
  const auth = requireAdminTier(); if (auth.response) return auth.response;
  await OnlineShopStripeConnectionRepository.remove(auth.user.businessId);
  return NextResponse.json({ success: true });
}