import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { OnlineShopFulfilmentSettingsRepository } from '@/lib/onlineShop/onlineShopFulfilmentSettings';
import { OnlineShopShippingRepository } from '@/lib/onlineShop/onlineShopShipping';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  try {
    const [rules, pickups, locations] = await Promise.all([
      OnlineShopShippingRepository.listRules(session.businessId),
      OnlineShopShippingRepository.listPickupOptions(session.businessId, false),
      OnlineShopFulfilmentSettingsRepository.listLocations(session.businessId),
    ]);
    return NextResponse.json({ success: true, rules, pickups, locations });
  } catch (error) {
    await reportRuntimeIssue({ businessId: session.businessId, source: 'online_shop_shipping', operation: 'admin_load',
      title: 'Online shop shipping settings could not be loaded', error }).catch(() => {});
    return NextResponse.json({ error: 'Shipping settings could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A valid shipping setting is required.' }, { status: 400 }); }
  try {
    if (body?.action === 'save_pickup') {
      await OnlineShopShippingRepository.savePickup(session.businessId, body);
      return NextResponse.json({ success: true });
    }
    const id = await OnlineShopShippingRepository.saveRule(session.businessId, body);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error instanceof Error && /required|shipping|postcode|state|location|threshold|amount/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    await reportRuntimeIssue({ businessId: session.businessId, source: 'online_shop_shipping', operation: 'admin_save',
      title: 'Online shop shipping setting could not be saved', error }).catch(() => {});
    return NextResponse.json({ error: 'Shipping setting could not be saved.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get('id'));
  try {
    await OnlineShopShippingRepository.deleteRule(session.businessId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && /ID|required/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    await reportRuntimeIssue({ businessId: session.businessId, source: 'online_shop_shipping', operation: 'admin_delete',
      title: 'Online shop shipping rule could not be deleted', error }).catch(() => {});
    return NextResponse.json({ error: 'Shipping rule could not be deleted.' }, { status: 500 });
  }
}