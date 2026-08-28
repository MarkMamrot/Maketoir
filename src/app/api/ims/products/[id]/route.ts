import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsProductsRepo, ImsVariantsRepo } from '@/lib/ims/ImsRepository';
import { isReservedShopifyFallbackSku, isShopifyFallbackProduct } from '@/lib/shopifyFallbackVariant';


export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsProductsRepo.get(params.id, businessId);
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const existing = await ImsProductsRepo.get(params.id, businessId);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    if (await isShopifyFallbackProduct(params.id, businessId)) {
      return NextResponse.json(
        { success: false, error: 'Shopify Misc Charge is a protected system product and cannot be edited manually.' },
        { status: 403 },
      );
    }
    const body = await req.json();
    if (isReservedShopifyFallbackSku(body?.base_sku)) {
      return NextResponse.json(
        { success: false, error: 'SHOPIFY-MISC is reserved for the Shopify system fallback product.' },
        { status: 403 },
      );
    }
    const { variants, ...productData } = body;
    const productSku = typeof productData.base_sku === 'string' ? productData.base_sku.trim() : '';
    if (productSku) {
      const conflict = await ImsVariantsRepo.findIdentifierConflict(
        'product_sku', productSku, { excludeProductId: params.id }, businessId,
      );
      if (conflict) {
        return NextResponse.json({
          success: false,
          error: `Product SKU "${productSku}" is already used by product "${conflict.product_name}". Enter a unique Product SKU.`,
          conflict,
        }, { status: 409 });
      }
    }
    const seenSkus = new Set<string>();
    const seenBarcodes = new Set<string>();
    for (const variant of variants ?? []) {
      for (const [field, bodyKey, label, seen] of [
        ['variant_sku', 'sku', 'Variant SKU', seenSkus],
        ['barcode', 'barcode', 'Barcode', seenBarcodes],
      ] as const) {
        const value = typeof variant?.[bodyKey] === 'string' ? variant[bodyKey].trim() : '';
        if (!value) continue;
        const normalized = value.toLowerCase();
        if (seen.has(normalized)) {
          return NextResponse.json({
            success: false,
            error: `${label} "${value}" is used more than once in this product. Enter a unique ${label} for each variant.`,
          }, { status: 409 });
        }
        seen.add(normalized);
        const conflict = await ImsVariantsRepo.findIdentifierConflict(
          field, value, { excludeVariantId: variant.variant_id }, businessId,
        );
        if (conflict) {
          return NextResponse.json({
            success: false,
            error: `${label} "${value}" is already used by product "${conflict.product_name}". Enter a unique ${label}.`,
            conflict,
          }, { status: 409 });
        }
      }
    }
    await ImsProductsRepo.update(params.id, productData);
    if (variants) {
      for (const v of variants) {
        if (v.variant_id) {
          await ImsVariantsRepo.update(v.variant_id, v);
        } else {
          await ImsVariantsRepo.create({ ...v, product_id: params.id }, businessId);
        }
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
    const existing = await ImsProductsRepo.get(params.id, businessId);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    if (await isShopifyFallbackProduct(params.id, businessId)) {
      return NextResponse.json(
        { success: false, error: 'Shopify Misc Charge is a protected system product and cannot be deleted.' },
        { status: 403 },
      );
    }
    await ImsProductsRepo.delete(params.id);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
