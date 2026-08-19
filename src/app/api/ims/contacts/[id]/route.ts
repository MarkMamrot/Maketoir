import { NextResponse } from 'next/server';
import { ImsContactsRepo } from '@/lib/ims/ImsRepository';
import { syncRetailCustomerToShopify } from '@/lib/ims/shopifyCustomerSync';
import { ShopifyLoyaltyMetafieldService } from '@/lib/loyalty/ShopifyLoyaltyMetafieldService';
import { getImsSession } from '@/lib/auth/imsSession';
import { validateContactChannels } from '@/lib/ims/contactDataQuality';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsContactsRepo.get(Number(params.id), businessId);
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  try {
    const existing = await ImsContactsRepo.get(Number(params.id), businessId);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const body = await req.json();
    if (Object.prototype.hasOwnProperty.call(body, 'store_credit')) {
      return NextResponse.json(
        { success: false, error: 'Store credit is read-only and is changed through completed customer credit notes.' },
        { status: 400 },
      );
    }
    const channels = validateContactChannels(body);
    if (channels.errors.length) {
      return NextResponse.json({ success: false, error: channels.errors.join(' ') }, { status: 400 });
    }
    Object.assign(body, channels.normalized);
    await ImsContactsRepo.update(Number(params.id), body);
    const updated = await ImsContactsRepo.get(Number(params.id), businessId);
    const shopifySync = updated ? await syncRetailCustomerToShopify(updated, businessId) : null;
    if (updated) {
      await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({ businessId, contactId: Number(params.id) });
    }
    return NextResponse.json({ success: true, shopifySync });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  try {
    const existing = await ImsContactsRepo.get(Number(params.id), businessId);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    await ImsContactsRepo.delete(Number(params.id));
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
