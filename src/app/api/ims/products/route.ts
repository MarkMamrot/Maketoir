import { NextResponse } from 'next/server';
import { ImsProductsRepo, ImsVariantsRepo } from '@/lib/ims/ImsRepository';
import { getImsSession } from '@/lib/auth/imsSession';
import { isReservedShopifyFallbackSku } from '@/lib/shopifyFallbackVariant';
import { normalizeProductCustomsFields } from '@/lib/ims/productCustoms';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsProductsRepo.list(businessId);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const body = await req.json();
    const customs = normalizeProductCustomsFields(body);
    if (customs.errors.length) {
      return NextResponse.json({ success: false, error: customs.errors[0].message, errors: customs.errors }, { status: 400 });
    }
    if (isReservedShopifyFallbackSku(body?.base_sku)) {
      return NextResponse.json(
        { success: false, error: 'SHOPIFY-MISC is reserved for the Shopify system fallback product.' },
        { status: 403 },
      );
    }
    const productSku = typeof body?.base_sku === 'string' ? body.base_sku.trim() : '';
    if (productSku) {
      const conflict = await ImsVariantsRepo.findIdentifierConflict('product_sku', productSku, {}, businessId);
      if (conflict) {
        return NextResponse.json({
          success: false,
          error: `Product SKU "${productSku}" is already used by product "${conflict.product_name}". Enter a unique Product SKU.`,
          conflict,
        }, { status: 409 });
      }
    }
    const product_id = await ImsProductsRepo.create({ ...body, ...customs.values }, businessId);
    return NextResponse.json({ success: true, product_id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
