import { NextResponse } from 'next/server';

import { OnlineShopPaymentService } from '@/lib/onlineShop/onlineShopPayments';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(_: Request, { params }: { params: { slug: string; checkoutId: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug);
  if (!profile) return NextResponse.json({ error: 'Store not found.' }, { status: 404 });
  try {
    return NextResponse.json({ success: true, payment: await OnlineShopPaymentService.create({ businessId: profile.businessId, checkoutId: params.checkoutId }) });
  } catch (error) {
    if (error instanceof Error && /expired|unavailable|valid checkout|not ready/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 409 });
    await reportRuntimeIssue({ businessId: profile.businessId, source: 'online_shop_stripe', operation: 'create_payment',
      title: 'Online shop Stripe payment could not be created', error, reference: { type: 'checkout', id: params.checkoutId } }).catch(() => {});
    return NextResponse.json({ error: 'Payment could not be started.' }, { status: 500 });
  }
}