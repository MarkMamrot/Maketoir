import { NextResponse } from 'next/server';
import { ImsVariantsRepo } from '@/lib/ims/ImsRepository';
import { getShopifyForBusiness, shopifyVariantPricePayload } from '@/lib/ims/shopifyInventorySync';
import { getImsSession } from '@/lib/auth/imsSession';
import { isShopifyFallbackVariant } from '@/lib/shopifyFallbackVariant';
import { notifySyncFailure } from '@/lib/ims/notifySyncFailure';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    if (await isShopifyFallbackVariant(params.id, session.businessId as string)) {
      return NextResponse.json(
        { success: false, error: 'Shopify Misc Charge is a protected system variant and cannot be edited manually.' },
        { status: 403 },
      );
    }
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
            const { getShopifyAdminCredentials } = await import('@/lib/shopifyCredentials');
            const credentials = await getShopifyAdminCredentials(session.businessId);
            if (!credentials) return;
            const payload: Record<string, any> = {
              ...shopifyVariantPricePayload(variant.price_rrp, variant.price_rrp_sale),
            };
            if (variant.sku)     payload.sku     = variant.sku;
            if (variant.barcode) payload.barcode = variant.barcode;
            await fetch(
              `https://${credentials.shopDomain}/admin/api/2024-01/variants/${variant.shopify_variant_id}.json`,
              {
                method: 'PUT',
                headers: { 'X-Shopify-Access-Token': credentials.token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ variant: { id: Number(variant.shopify_variant_id), ...payload } }),
                signal: AbortSignal.timeout(15000),
              },
            );
          } catch (e) {
            console.error('[variant PUT] Shopify sync failed:', e);
            await notifySyncFailure({
              businessId: String(session.businessId),
              source: 'shopify_sync',
              title: 'Shopify Sync Failed — Variant Update',
              message: `Variant ${params.id} failed to push to Shopify. ${e instanceof Error ? e.message : String(e)}`,
              detail: {
                variant_id: params.id,
                shopify_variant_id: variant.shopify_variant_id,
                sku: variant.sku,
              },
              dedupeKey: `shopify:variant:${params.id}`,
              dedupeMinutes: 60,
            }).catch(() => {});
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
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    if (await isShopifyFallbackVariant(params.id, session.businessId as string)) {
      return NextResponse.json(
        { success: false, error: 'Shopify Misc Charge is a protected system variant and cannot be deleted.' },
        { status: 403 },
      );
    }
    await ImsVariantsRepo.delete(params.id);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

