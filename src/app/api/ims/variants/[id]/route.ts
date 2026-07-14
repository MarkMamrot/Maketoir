import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsVariantsRepo } from '@/lib/ims/ImsRepository';
import { getShopifyForBusiness, shopifyVariantPricePayload } from '@/lib/ims/shopifyInventorySync';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json();
    await ImsVariantsRepo.update(params.id, body);

    // Fire-and-forget Shopify price sync when price changes and variant is linked
    if (body.price_rrp !== undefined || body.price_rrp_sale !== undefined) {
      const variant = await ImsVariantsRepo.get(params.id);
      if (variant?.shopify_variant_id) {
        (async () => {
          try {
            const shopify = await getShopifyForBusiness(session.businessId);
            if (!shopify) return;
            await shopify.updateVariant(variant.shopify_variant_id!, shopifyVariantPricePayload(variant.price_rrp, variant.price_rrp_sale));
          } catch (e) {
            console.error('[variant PUT] Shopify price sync failed:', e);
          }
        })();
      }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    await ImsVariantsRepo.delete(params.id);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

