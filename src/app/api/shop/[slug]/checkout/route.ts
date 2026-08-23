import { NextResponse } from 'next/server';

import { OnlineShopCheckoutRepository } from '@/lib/onlineShop/onlineShopCheckout';
import { OnlineShopStockConflict } from '@/lib/onlineShop/fulfilmentAllocation';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug);
  if (!profile) return NextResponse.json({ error: 'Store not found.' }, { status: 404 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A valid checkout request is required.' }, { status: 400 }); }
  if (!['pickup', 'delivery'].includes(body?.fulfilmentType)) return NextResponse.json({ error: 'Choose delivery or pickup.' }, { status: 400 });
  try {
    const checkout = body.fulfilmentType === 'pickup'
      ? await OnlineShopCheckoutRepository.createPickup({ businessId: profile.businessId,
        guestEmail: String(body?.guestEmail ?? ''), pickupLocationId: Number(body?.pickupLocationId), cart: body?.cart })
      : await OnlineShopCheckoutRepository.createDelivery({ businessId: profile.businessId,
        guestEmail: String(body?.guestEmail ?? ''), shippingRuleId: Number(body?.shippingRuleId), shippingAddress: body?.shippingAddress, cart: body?.cart });
    return NextResponse.json({ success: true, checkout }, { status: 201 });
  } catch (error) {
    if (error instanceof OnlineShopStockConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof Error && /cart|email|pickup location/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    await reportRuntimeIssue({ businessId: profile.businessId, source: 'online_shop_checkout', operation: 'create_pickup',
      title: 'Online shop pickup checkout could not be created', error }).catch(() => {});
    return NextResponse.json({ error: 'Checkout could not be created.' }, { status: 500 });
  }
}