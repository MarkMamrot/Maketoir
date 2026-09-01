import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { BulkProductValidationError, saveBulkProducts } from '@/lib/ims/bulkProductSave';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId ?? '');
  const url = new URL(request.url);
  const requestedPage = Number(url.searchParams.get('page'));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const perPage = 50;
  const search = String(url.searchParams.get('q') ?? '').trim();
  const brand = String(url.searchParams.get('brand') ?? '').trim();
  const supplierId = Number(url.searchParams.get('supplier')) || 0;
  const conditions = ['p.business_id = ?'];
  const params: unknown[] = [businessId];
  if (search) {
    conditions.push(`(p.name LIKE ? OR p.base_sku LIKE ? OR p.brand LIKE ? OR EXISTS (
      SELECT 1 FROM ims_product_variants sv WHERE sv.product_id = p.product_id AND sv.business_id = p.business_id AND (sv.sku LIKE ? OR sv.barcode LIKE ?)))`);
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (brand) { conditions.push('p.brand = ?'); params.push(brand); }
  if (supplierId) { conditions.push('p.supplier_contact_id = ?'); params.push(supplierId); }

  try {
    const where = conditions.join(' AND ');
    const countRows = await imsQuery<{ total: number }>(`SELECT COUNT(*) AS total FROM ims_products p WHERE ${where}`, params);
    const products = await imsQuery<Record<string, unknown>>(
      `SELECT p.*, c.name AS supplier_name
         FROM ims_products p
         LEFT JOIN ims_contacts c ON c.id = p.supplier_contact_id AND c.business_id = p.business_id
        WHERE ${where}
        ORDER BY p.name, p.product_id
        LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
      params,
    );
    const productIds = products.map(product => String(product.product_id));
    const variants = productIds.length
      ? await imsQuery<Record<string, unknown>>(
          `SELECT * FROM ims_product_variants
            WHERE business_id = ? AND product_id IN (${productIds.map(() => '?').join(', ')})
            ORDER BY product_id, sku, variant_id`,
          [businessId, ...productIds],
        )
      : [];
    const variantIds = variants.map(variant => String(variant.variant_id));
    const locationStock = variantIds.length
      ? await imsQuery<Record<string, unknown>>(
          `SELECT variant_id, location_id, qty_on_hand, min_qty, reorder_qty, zone, bin
             FROM ims_stock
            WHERE business_id = ? AND variant_id IN (${variantIds.map(() => '?').join(', ')})
            ORDER BY variant_id, location_id`,
          [businessId, ...variantIds],
        )
      : [];
    const stockByVariant = new Map<string, Record<string, unknown>[]>();
    for (const stock of locationStock) {
      const variantId = String(stock.variant_id);
      stockByVariant.set(variantId, [...(stockByVariant.get(variantId) ?? []), stock]);
    }
    const variantsByProduct = new Map<string, Record<string, unknown>[]>();
    for (const variant of variants) {
      const productId = String(variant.product_id);
      variantsByProduct.set(productId, [...(variantsByProduct.get(productId) ?? []), {
        ...variant,
        location_stock: stockByVariant.get(String(variant.variant_id)) ?? [],
      }]);
    }
    return NextResponse.json({
      success: true,
      products: products.map(product => ({ ...product, variants: variantsByProduct.get(String(product.product_id)) ?? [] })),
      total: Number(countRows[0]?.total ?? 0),
      page,
      perPage,
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims-products',
      operation: 'bulk_add_edit_list',
      title: 'Bulk Add/Edit products could not be loaded',
      error,
      context: { page, hasSearch: Boolean(search), hasBrand: Boolean(brand), hasSupplier: Boolean(supplierId) },
    });
    return NextResponse.json({ success: false, error: 'Products could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId ?? '');
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  try {
    const result = await saveBulkProducts(businessId, body);
    if (result.stockVariantIds.length) {
      try {
        await refreshVariantCache(result.stockVariantIds);
      } catch (error) {
        await reportRuntimeIssue({
          businessId,
          source: 'ims-products',
          operation: 'bulk_add_edit_stock_cache_refresh',
          title: 'Bulk Add/Edit stock cache refresh failed',
          error,
          context: { variantCount: result.stockVariantIds.length },
        });
      }
    }
    const { stockVariantIds: _stockVariantIds, ...response } = result;
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof BulkProductValidationError) {
      return NextResponse.json({ success: false, error: error.message, errors: error.errors }, { status: 409 });
    }
    const productCount = Array.isArray((body as { products?: unknown[] } | null)?.products)
      ? (body as { products: unknown[] }).products.length
      : 0;
    await reportRuntimeIssue({
      businessId,
      source: 'ims-products',
      operation: 'bulk_add_edit_save',
      title: 'Bulk Add/Edit product save failed',
      error,
      context: { productCount },
    });
    return NextResponse.json({ success: false, error: 'No products were saved. Please try again.' }, { status: 500 });
  }
}