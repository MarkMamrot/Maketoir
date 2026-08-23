import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { ONLINE_SHOP_SESSION_COOKIE, verifyOnlineShopSession } from '@/lib/onlineShop/onlineShopSession';
import { OnlineShopValueService } from '@/lib/onlineShop/onlineShopValues';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

function resolveContext(slug: string, businessId: string) {
  const session = verifyOnlineShopSession(cookies().get(ONLINE_SHOP_SESSION_COOKIE)?.value ?? '');
  if (!session || session.businessId !== businessId || session.storeSlug !== slug) return null;
  return session;
}

function customerError(error: unknown): boolean {
  return error instanceof Error && /checkout|customer|reward|loyalty|credit|payment|signed-in/i.test(error.message);
}

export async function GET(_: Request, { params }: { params: { slug: string; checkoutId: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug);
  if (!profile) return NextResponse.json({ error: 'Store not found.' }, { status: 404 });
  const session = resolveContext(profile.slug, profile.businessId);
  if (!session) return NextResponse.json({ error: 'Sign in to use rewards or store credit.' }, { status: 401 });
  try {
    const quote = await OnlineShopValueService.quote({ businessId: profile.businessId, checkoutId: params.checkoutId,
      contactId: session.contactId, email: session.email });
    return NextResponse.json({ success: true, quote });
  } catch (error) {
    if (customerError(error)) return NextResponse.json({ error: (error as Error).message }, { status: 409 });
    await reportRuntimeIssue({ businessId: profile.businessId, source: 'online_shop_values', operation: 'quote',
      title: 'Online shop customer value quote failed', error, reference: { type: 'checkout', id: params.checkoutId } }).catch(() => {});
    return NextResponse.json({ error: 'Rewards and store credit could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { slug: string; checkoutId: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug);
  if (!profile) return NextResponse.json({ error: 'Store not found.' }, { status: 404 });
  const session = resolveContext(profile.slug, profile.businessId);
  if (!session) return NextResponse.json({ error: 'Sign in to use rewards or store credit.' }, { status: 401 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A valid value selection is required.' }, { status: 400 }); }
  try {
    const quote = await OnlineShopValueService.reserve({ businessId: profile.businessId, checkoutId: params.checkoutId,
      contactId: session.contactId, email: session.email, rewardId: body.rewardId == null ? null : Number(body.rewardId),
      storeCreditCents: Number(body.storeCreditCents ?? 0) });
    return NextResponse.json({ success: true, quote });
  } catch (error) {
    if (customerError(error) || error instanceof Error && /valid/i.test(error.message)) {
      return NextResponse.json({ error: (error as Error).message }, { status: 409 });
    }
    await reportRuntimeIssue({ businessId: profile.businessId, source: 'online_shop_values', operation: 'reserve',
      title: 'Online shop customer value reservation failed', error, reference: { type: 'checkout', id: params.checkoutId } }).catch(() => {});
    return NextResponse.json({ error: 'Rewards and store credit could not be reserved.' }, { status: 500 });
  }
}