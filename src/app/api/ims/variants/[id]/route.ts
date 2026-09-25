import { NextResponse } from 'next/server';
import { ImsVariantsRepo } from '@/lib/ims/ImsRepository';
import { shopifyVariantPricePayload } from '@/lib/ims/shopifyInventorySync';
import { getImsSession } from '@/lib/auth/imsSession';
import { isShopifyFallbackVariant } from '@/lib/shopifyFallbackVariant';
import { notifySyncFailure } from '@/lib/ims/notifySyncFailure';
import { parseWholesalePackSizeInput } from '@/lib/wholesale/wholesaleOrderQuantity';
import { FifoCostingConflict } from '@/lib/ims/costing/fifoCostingService';
import { imsQuery } from '@/services/IMSMySQLService';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { ShopifyService } from '@/services/ShopifyService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';

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
    if (body.pack_size !== undefined) {
      try { body.pack_size = parseWholesalePackSizeInput(body.pack_size); }
      catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Invalid wholesale selling pack size.' }, { status: 400 }); }
    }
    for (const [field, bodyKey, label] of [['variant_sku', 'sku', 'Variant SKU'], ['barcode', 'barcode', 'Barcode']] as const) {
      const value = typeof body?.[bodyKey] === 'string' ? body[bodyKey].trim() : '';
      if (!value) continue;
      const conflict = await ImsVariantsRepo.findIdentifierConflict(
        field, value, { excludeVariantId: params.id }, session.businessId as string,
      );
      if (conflict) {
        return NextResponse.json({
          success: false,
          error: `${label} "${value}" is already used by product "${conflict.product_name}". Enter a unique ${label}.`,
          conflict,
        }, { status: 409 });
      }
    }
    await ImsVariantsRepo.update(params.id, body);

    // Fire-and-forget Shopify sync when price, SKU, or barcode changes and variant is linked
    if (body.price_rrp !== undefined || body.price_rrp_sale !== undefined ||
        body.sku !== undefined || body.barcode !== undefined) {
      const variant = await ImsVariantsRepo.get(params.id);
      if (variant) {
        const shopifyInstanceIds = (await SalesChannelInstanceRepository.listForBusiness(String(session.businessId)))
          .filter(instance => instance.provider === 'shopify')
          .map(instance => instance.channelInstanceId);
        if (shopifyInstanceIds.length === 0) return NextResponse.json({ success: true });
        const mappings = await imsQuery<{ channel_instance_id: string; external_variant_id: string }>(
          `SELECT channel_instance_id, external_variant_id
             FROM ims_sales_channel_product_mappings
            WHERE business_id = ? AND variant_id = ? AND mapping_status = 'linked'
              AND channel_instance_id IN (${shopifyInstanceIds.map(() => '?').join(',')})
              AND external_variant_id IS NOT NULL AND external_variant_id <> ''`,
          [session.businessId, params.id, ...shopifyInstanceIds],
        );
        await Promise.allSettled(mappings.map(async mapping => {
          try {
            const { credentials } = await getShopifyOperationContext({
              businessId: session.businessId,
              channelInstanceId: mapping.channel_instance_id,
            });
            const payload: Record<string, any> = {
              ...shopifyVariantPricePayload(variant.price_rrp, variant.price_rrp_sale),
            };
            if (variant.sku)     payload.sku     = variant.sku;
            if (variant.barcode) payload.barcode = variant.barcode;
            const shopify = new ShopifyService(credentials.shopDomain, credentials.token);
            await shopify.updateVariant(mapping.external_variant_id, payload);
          } catch (e) {
            await reportRuntimeIssue({
              businessId: String(session.businessId),
              source: 'shopify_variant',
              operation: 'update_variant',
              title: 'Shopify variant update failed',
              error: e,
              context: {
                channelInstanceId: mapping.channel_instance_id,
                variantId: params.id,
                externalVariantId: mapping.external_variant_id,
              },
            }).catch(() => null);
            await notifySyncFailure({
              businessId: String(session.businessId),
              source: 'shopify_sync',
              title: 'Shopify Sync Failed — Variant Update',
              message: `Variant ${params.id} failed to push to Shopify. ${e instanceof Error ? e.message : String(e)}`,
              detail: {
                variant_id: params.id,
                channel_instance_id: mapping.channel_instance_id,
                shopify_variant_id: mapping.external_variant_id,
                sku: variant.sku,
              },
              dedupeKey: `shopify:variant:${mapping.channel_instance_id}:${params.id}`,
              dedupeMinutes: 60,
            }).catch(() => {});
          }
        }));
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
  const businessId = session.businessId as string;
  try {
    if (await isShopifyFallbackVariant(params.id, businessId)) {
      return NextResponse.json(
        { success: false, error: 'Shopify Misc Charge is a protected system variant and cannot be deleted.' },
        { status: 403 },
      );
    }
    await ImsVariantsRepo.delete(params.id, businessId);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message, ...(e?.code ? { code: e.code } : {}) },
      { status: e instanceof FifoCostingConflict ? e.status : 500 },
    );
  }
}

