import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { normalizeOnlineShopPageSlug } from '@/lib/onlineShop/onlineShopPages';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

function duplicate(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY'); }

export async function GET(request: Request) {
  const session = await getImsSession(); if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const businessId = session.businessId; const url = new URL(request.url); const search = url.searchParams.get('q')?.trim().slice(0, 100) ?? '';
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1); const limit = 40; const offset = (page - 1) * limit;
  const filter = url.searchParams.get('filter') === 'published' ? 'published' : url.searchParams.get('filter') === 'unpublished' ? 'unpublished' : 'all';
  const where = [`p.business_id = ?`, `p.is_active = 1`]; const params: unknown[] = [businessId];
  if (search) { where.push(`(p.name LIKE ? OR p.brand LIKE ? OR p.base_sku LIKE ?)`); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (filter === 'published') where.push(`pub.is_published = 1`); if (filter === 'unpublished') where.push(`COALESCE(pub.is_published, 0) = 0`);
  try {
    const [rows, countRows] = await Promise.all([
      imsQuery(`SELECT p.product_id, p.name, p.brand, p.base_sku, p.shopify_product_id, pub.slug,
        COALESCE(pub.is_published, 0) AS is_published, pub.meta_title, pub.meta_description, pub.published_at,
        COUNT(DISTINCT CASE WHEN v.is_active = 1 AND v.price_rrp > 0 THEN v.variant_id END) AS retail_variant_count
        FROM ims_products p LEFT JOIN ims_online_shop_products pub ON pub.product_id = p.product_id AND pub.business_id = p.business_id
        LEFT JOIN ims_product_variants v ON v.product_id = p.product_id AND v.business_id = p.business_id
        WHERE ${where.join(' AND ')} GROUP BY p.product_id, p.name, p.brand, p.base_sku, p.shopify_product_id, pub.slug,
          pub.is_published, pub.meta_title, pub.meta_description, pub.published_at ORDER BY p.name, p.product_id LIMIT ${limit} OFFSET ${offset}`, params),
      imsQuery<{ total: number | string }>(`SELECT COUNT(*) AS total FROM ims_products p
        LEFT JOIN ims_online_shop_products pub ON pub.product_id = p.product_id AND pub.business_id = p.business_id
        WHERE ${where.join(' AND ')}`, params),
    ]);
    return NextResponse.json({ success: true, products: rows, page, total: Number(countRows[0]?.total ?? 0), limit });
  } catch (error) {
    await reportRuntimeIssue({ businessId, source: 'online_shop_products', operation: 'list', title: 'Online shop product publication list failed', error }).catch(() => {});
    return NextResponse.json({ error: 'Online shop products could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await getImsSession(); if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const businessId = session.businessId; let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A valid JSON body is required.' }, { status: 400 }); }
  const productId = String(body?.productId ?? '').trim(); const isPublished = body?.isPublished === true;
  const slug = normalizeOnlineShopPageSlug(body?.slug); if (!productId) return NextResponse.json({ error: 'Product is required.' }, { status: 400 });
  if (isPublished && slug.length < 2) return NextResponse.json({ error: 'A product address is required before publishing.' }, { status: 400 });
  try {
    const products = await imsQuery<{ product_id: string }>('SELECT product_id FROM ims_products WHERE business_id = ? AND product_id = ? AND is_active = 1 LIMIT 1', [businessId, productId]);
    if (!products[0]) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    await imsExecute(`INSERT INTO ims_online_shop_products (business_id, product_id, slug, meta_title, meta_description, is_published, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ${isPublished ? 'CURRENT_TIMESTAMP' : 'NULL'})
      ON DUPLICATE KEY UPDATE slug = VALUES(slug), meta_title = VALUES(meta_title), meta_description = VALUES(meta_description),
        is_published = VALUES(is_published), published_at = CASE WHEN VALUES(is_published) = 1 THEN COALESCE(published_at, CURRENT_TIMESTAMP) ELSE NULL END`,
    [businessId, productId, slug || `product-${productId.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`,
      String(body?.metaTitle ?? '').trim().slice(0, 255) || null, String(body?.metaDescription ?? '').trim().slice(0, 500) || null, isPublished ? 1 : 0]);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (duplicate(error)) return NextResponse.json({ error: 'That product address is already in use.' }, { status: 409 });
    await reportRuntimeIssue({ businessId, source: 'online_shop_products', operation: isPublished ? 'publish' : 'unpublish', title: 'Online shop product publication update failed', error,
      reference: { type: 'ims_product', id: productId } }).catch(() => {});
    return NextResponse.json({ error: 'The product publication setting could not be saved.' }, { status: 500 });
  }
}