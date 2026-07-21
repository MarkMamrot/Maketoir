import { NextResponse } from 'next/server';
import { ImsVariantsRepo } from '@/lib/ims/ImsRepository';
import { getShopifyForBusiness, shopifyVariantPricePayload } from '@/lib/ims/shopifyInventorySync';
import { getImsSession } from '@/lib/auth/imsSession';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json();
    await ImsVariantsRepo.update(params.id, body);

    // Fire-and-forget Shopify sync when price, SKU, or barcode changes and variant is linked
    if (body.price_rrp !== undefined || body.price_rrp_sale !== undefined ||
        body.sku !== undefined || body.barcode !== undefined) {
      const variant = await ImsVariantsRepo.get(params.id);
      if (variant?.shopify_variant_id) {
        (async () => {
          try {
            const conn = await getShopifyForBusiness(session.businessId);
            if (!conn) return;
            // Build payload — use direct fetch so sku/barcode aren't silently dropped
            // by the shopify-api-node library's type mapping.
            const { ConnectionsRepository } = await import('@/lib/db/ConnectionsRepository');
            const { decrypt } = await import('@/lib/encryption');
            const connRow = await ConnectionsRepository.get(session.businessId) as any;
            const shopName    = String(connRow?.shopify_shop_id ?? '').replace(/\.myshopify\.com$/, '');
            const accessToken = decrypt(connRow?.shopify_access_token ?? '');
            if (!shopName || !/^[a-zA-Z0-9-]+$/.test(shopName)) return;
            const payload: Record<string, any> = {
              ...shopifyVariantPricePayload(variant.price_rrp, variant.price_rrp_sale),
            };
            if (variant.sku)     payload.sku     = variant.sku;
            if (variant.barcode) payload.barcode = variant.barcode;
            await fetch(
              `https://${shopName}.myshopify.com/admin/api/2024-01/variants/${variant.shopify_variant_id}.json`,
              {
                method: 'PUT',
                headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
                body: JSON.stringify({ variant: { id: Number(variant.shopify_variant_id), ...payload } }),
                signal: AbortSignal.timeout(15000),
              },
            );
          } catch (e) {
            console.error('[variant PUT] Shopify sync failed:', e);
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
  if (!await getImsSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    await ImsVariantsRepo.delete(params.id);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

