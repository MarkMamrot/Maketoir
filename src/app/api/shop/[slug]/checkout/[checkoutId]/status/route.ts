import { NextResponse } from 'next/server';

import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { imsQuery } from '@/services/IMSMySQLService';

export async function GET(_: Request, { params }: { params: { slug: string; checkoutId: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug);
  if (!profile) return NextResponse.json({ error: 'Store not found.' }, { status: 404 });
  if (!/^[0-9a-f-]{36}$/i.test(params.checkoutId)) return NextResponse.json({ error: 'Checkout not found.' }, { status: 404 });
  const result = await runImsForBusiness(profile.businessId, async () => {
    const rows = await imsQuery<{ status: string; total_cents: number; currency_code: string; completed_at: string | null }>(
      'SELECT status, total_cents, currency_code, completed_at FROM ims_online_shop_checkouts WHERE business_id = ? AND checkout_id = ? LIMIT 1',
      [profile.businessId, params.checkoutId],
    );
    return rows[0] ?? null;
  });
  if (!result) return NextResponse.json({ error: 'Checkout not found.' }, { status: 404 });
  return NextResponse.json({ success: true, checkout: { status: result.status, totalCents: Number(result.total_cents),
    currencyCode: result.currency_code, completedAt: result.completed_at } });
}