import { NextResponse } from 'next/server';

import { getOnlineShopActivationState, setOnlineShopActivation } from '@/lib/onlineShop/onlineShopActivation';
import { nativeShopDisabledResponse } from '@/lib/onlineShop/onlineShopCapability';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminTier } from '@/lib/sessionUtils';

export async function GET() {
  const auth = requireAdminTier(); if (auth.response) return auth.response;
  const disabled = await nativeShopDisabledResponse(auth.user.businessId); if (disabled) return disabled;
  return NextResponse.json({ success: true, state: await getOnlineShopActivationState(auth.user.businessId) });
}

export async function PUT(request: Request) {
  const auth = requireAdminTier(); if (auth.response) return auth.response;
  const disabled = await nativeShopDisabledResponse(auth.user.businessId); if (disabled) return disabled;
  let body: any; try { body = await request.json(); } catch { return NextResponse.json({ error: 'A valid activation request is required.' }, { status: 400 }); }
  try {
    const state = await setOnlineShopActivation({ businessId: auth.user.businessId, active: body?.active === true,
      actorUserId: auth.user.userId, actorName: auth.user.name });
    return NextResponse.json({ success: true, state });
  } catch (error) {
    if (error instanceof Error && /readiness/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 409 });
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'online_shop_activation', operation: 'change', title: 'Online shop activation failed', error }).catch(() => {});
    return NextResponse.json({ error: 'Online shop activation could not be changed.' }, { status: 500 });
  }
}