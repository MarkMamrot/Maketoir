import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsVariantsRepo } from '@/lib/ims/ImsRepository';
import { ShopifyService } from '@/services/ShopifyService';
import { decrypt } from '@/lib/encryption';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';

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
            const conn = await ConnectionsRepository.get(session.userSpreadsheetId);
            const rawShopId = conn?.shopify_shop_id ?? '';
            const encToken  = conn?.shopify_access_token ?? '';
            if (!rawShopId || !encToken) return;
            const shopName = rawShopId.replace(/\.myshopify\.com$/, '');
            if (!/^[a-zA-Z0-9-]+$/.test(shopName)) return;
            const shopify = new ShopifyService(shopName, decrypt(encToken));
            const updatedVariant = body.price_rrp !== undefined ? variant : await ImsVariantsRepo.get(params.id);
            await shopify.updateVariant(variant.shopify_variant_id!, {
              price: String(updatedVariant?.price_rrp ?? variant.price_rrp ?? '0.00'),
              compare_at_price: updatedVariant?.price_rrp_sale
                ? String(updatedVariant.price_rrp ?? '0.00')
                : null,
            });
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

