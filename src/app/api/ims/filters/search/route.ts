import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export interface FilterSuggestion {
  type: 'product' | 'brand' | 'supplier' | 'product_type' | 'category' | 'subcategory';
  value: string;
  label: string;
  meta?: string;
}

/**
 * GET /api/ims/filters/search?q=<text>&limit=25&only=supplier|brand|product_type|product
 *
 * Mixed mode order: supplier → brand → product_type → products.
 * When `only` is set, returns only that category (q may be empty = browse all).
 */
export async function GET(req: Request) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q     = (searchParams.get('q') ?? '').trim();
  const only  = (searchParams.get('only') ?? '').trim();
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '25', 10)));

  // In mixed mode require ≥1 char; in only-mode allow empty (browse all)
  if (!only && q.length < 1) return NextResponse.json({ suggestions: [] });

  const like      = q ? `%${q}%` : '%';
  const exactLike = q ? `${q}%`  : '%';
  const session = getSession();
  const businessId = session?.businessId as string | undefined;

  const wantSupplier    = !only || only === 'supplier';
  const wantBrand       = !only || only === 'brand';
  const wantType        = !only || only === 'product_type';
  const wantProduct     = !only || only === 'product';
  const wantCategory    = !only || only === 'category';
  const wantSubcategory = !only || only === 'subcategory';

  // ── Suppliers ──────────────────────────────────────────────────────────────
  let supplierSuggestions: FilterSuggestion[] = [];
  if (wantSupplier) {
    try {
      const rows = await imsQuery<{ id: number; name: string }>(`
        SELECT DISTINCT c.id, c.name
        FROM ims_contacts c
        JOIN ims_products p ON p.supplier_contact_id = c.id AND p.is_active = 1
        WHERE c.is_active = 1 AND c.name LIKE ?
          ${businessId ? 'AND p.business_id = ?' : ''}
        ORDER BY CASE WHEN c.name LIKE ? THEN 0 ELSE 1 END, c.name
        LIMIT ?
      `, businessId ? [like, businessId, exactLike, limit] : [like, exactLike, limit]);
      supplierSuggestions = rows.map(r => ({
        type: 'supplier' as const,
        value: String(r.id),
        label: `Supplier: ${r.name}`,
        meta: 'Filter all products from this supplier',
      }));
    } catch { /* supplier_contact_id column not yet added */ }
  }

  // ── Brands ────────────────────────────────────────────────────────────────
  let brandSuggestions: FilterSuggestion[] = [];
  if (wantBrand) {
    try {
      const rows = await imsQuery<{ brand: string }>(`
        SELECT DISTINCT brand FROM ims_products
        WHERE is_active = 1 AND brand IS NOT NULL AND brand != '' AND brand LIKE ?
          ${businessId ? 'AND business_id = ?' : ''}
        ORDER BY CASE WHEN brand LIKE ? THEN 0 ELSE 1 END, brand
        LIMIT ?
      `, businessId ? [like, businessId, exactLike, limit] : [like, exactLike, limit]);
      brandSuggestions = rows.map(r => ({
        type: 'brand' as const,
        value: r.brand,
        label: `Brand: ${r.brand}`,
        meta: 'Filter all products from this brand',
      }));
    } catch { /* skip */ }
  }

  // ── Product Types ─────────────────────────────────────────────────────────
  let typeSuggestions: FilterSuggestion[] = [];
  if (wantType) {
    try {
      const rows = await imsQuery<{ product_type: string }>(`
        SELECT DISTINCT product_type FROM ims_products
        WHERE is_active = 1 AND product_type IS NOT NULL AND product_type != '' AND product_type LIKE ?
          ${businessId ? 'AND business_id = ?' : ''}
        ORDER BY CASE WHEN product_type LIKE ? THEN 0 ELSE 1 END, product_type
        LIMIT ?
      `, businessId ? [like, businessId, exactLike, limit] : [like, exactLike, limit]);
      typeSuggestions = rows.map(r => ({
        type: 'product_type' as const,
        value: r.product_type,
        label: `Type: ${r.product_type}`,
        meta: 'Filter all products of this type',
      }));
    } catch { /* skip */ }
  }

  // ── Products (variants) ───────────────────────────────────────────────────
  let productSuggestions: FilterSuggestion[] = [];
  if (wantProduct && q.length > 0) {
    try {
      const rows = await imsQuery<{
        variant_id: string; sku: string | null; barcode: string | null;
        product_name: string; brand: string | null; option_label: string | null;
      }>(`
        SELECT v.variant_id, v.sku, v.barcode, p.name AS product_name, p.brand,
          TRIM(BOTH ' / ' FROM CONCAT_WS(' / ',
            NULLIF(TRIM(COALESCE(v.option1_value,'')), ''),
            NULLIF(TRIM(COALESCE(v.option2_value,'')), ''),
            NULLIF(TRIM(COALESCE(v.option3_value,'')), '')
          )) AS option_label
        FROM ims_product_variants v
        JOIN ims_products p ON p.product_id = v.product_id
        WHERE v.is_active = 1 AND p.is_active = 1
          ${businessId ? 'AND p.business_id = ?' : ''}
          AND (v.sku LIKE ? OR v.barcode LIKE ? OR p.name LIKE ?)
        ORDER BY p.name, v.sku
        LIMIT ${limit}
      `, businessId ? [businessId, like, like, like] : [like, like, like]);

      productSuggestions = rows.map(r => {
        const nameParts = [r.product_name, r.option_label].filter(Boolean);
        const metaParts: string[] = [];
        if (r.sku) metaParts.push(`SKU: ${r.sku}`);
        if (r.barcode) metaParts.push(`Barcode: ${r.barcode}`);
        return {
          type: 'product' as const,
          value: r.variant_id,
          label: `Product: ${nameParts.join(' — ')}  ·  Brand: ${r.brand ?? '—'}`,
          meta: metaParts.join('  ·  ') || undefined,
        };
      });
    } catch { /* skip */ }
  }

  const suggestions: FilterSuggestion[] = [
    ...supplierSuggestions,
    ...brandSuggestions,
    ...typeSuggestions,
    ...productSuggestions,
  ].slice(0, limit);

  // ── Categories ───────────────────────────────────────────────────────────
  if (wantCategory) {
    try {
      const rows = await imsQuery<{ category: string }>(`
        SELECT DISTINCT category FROM ims_products
        WHERE is_active = 1 AND category IS NOT NULL AND category != '' AND category LIKE ?
          ${businessId ? 'AND business_id = ?' : ''}
        ORDER BY CASE WHEN category LIKE ? THEN 0 ELSE 1 END, category
        LIMIT ?
      `, businessId ? [like, businessId, exactLike, limit] : [like, exactLike, limit]);
      const cats: FilterSuggestion[] = rows.map(r => ({
        type: 'category' as const, value: r.category,
        label: `Category: ${r.category}`, meta: 'Filter by category',
      }));
      return NextResponse.json({ suggestions: [...cats, ...suggestions].slice(0, limit) });
    } catch { /* skip */ }
  }

  // ── Subcategories ─────────────────────────────────────────────────────────
  if (wantSubcategory) {
    try {
      const rows = await imsQuery<{ subcategory: string }>(`
        SELECT DISTINCT subcategory FROM ims_products
        WHERE is_active = 1 AND subcategory IS NOT NULL AND subcategory != '' AND subcategory LIKE ?
          ${businessId ? 'AND business_id = ?' : ''}
        ORDER BY CASE WHEN subcategory LIKE ? THEN 0 ELSE 1 END, subcategory
        LIMIT ?
      `, businessId ? [like, businessId, exactLike, limit] : [like, exactLike, limit]);
      const subs: FilterSuggestion[] = rows.map(r => ({
        type: 'subcategory' as const, value: r.subcategory,
        label: `Subcategory: ${r.subcategory}`, meta: 'Filter by subcategory',
      }));
      return NextResponse.json({ suggestions: [...subs, ...suggestions].slice(0, limit) });
    } catch { /* skip */ }
  }

  return NextResponse.json({ suggestions });
}
