import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export interface FilterSuggestion {
  type: 'product' | 'brand' | 'supplier' | 'product_type';
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

  const wantSupplier = !only || only === 'supplier';
  const wantBrand    = !only || only === 'brand';
  const wantType     = !only || only === 'product_type';
  const wantProduct  = !only || only === 'product';

  // ── Suppliers ──────────────────────────────────────────────────────────────
  let supplierSuggestions: FilterSuggestion[] = [];
  if (wantSupplier) {
    try {
      const rows = await imsQuery<{ id: number; name: string }>(`
        SELECT DISTINCT c.id, c.name
        FROM ims_contacts c
        JOIN ims_products p ON p.supplier_contact_id = c.id AND p.is_active = 1
        WHERE c.is_active = 1 AND c.name LIKE ?
        ORDER BY CASE WHEN c.name LIKE ? THEN 0 ELSE 1 END, c.name
        LIMIT ?
      `, [like, exactLike, limit]);
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
        ORDER BY CASE WHEN brand LIKE ? THEN 0 ELSE 1 END, brand
        LIMIT ?
      `, [like, exactLike, limit]);
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
        ORDER BY CASE WHEN product_type LIKE ? THEN 0 ELSE 1 END, product_type
        LIMIT ?
      `, [like, exactLike, limit]);
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

  return NextResponse.json({ suggestions });
}


// ─── Types ───────────────────────────────────────────────────────────────────
export interface FilterSuggestion {
  /** Determines how the consuming report applies this filter */
  type: 'product' | 'brand' | 'supplier' | 'product_type';
  /** Stable identifier used as query param value */
  value: string;
  /** Primary display string shown in the dropdown */
  label: string;
  /** Secondary sub-label shown beneath in lighter text */
  meta?: string;
}

/**
 * GET /api/ims/filters/search?q=<text>&limit=25&only=supplier|brand|product_type
 *
 * Returns mixed suggestions for the report filter combobox.
 * Order (mixed mode): supplier → brand → product_type → products.
 * When `only` is set, returns only that category (q may be empty = browse all).
 */
export async function GET(req: Request) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q     = (searchParams.get('q') ?? '').trim();
  const only  = (searchParams.get('only') ?? '').trim(); // supplier | brand | product_type | product
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '25', 10)));

  // For `only` mode with no query, return all (browse). For mixed mode, require at least 1 char.
  if (!only && q.length < 1) return NextResponse.json({ suggestions: [] });

  const like      = q ? `%${q}%` : '%';
  const exactLike = q ? `${q}%`  : '%';
  const session = getSession();
  const businessId = session?.businessId as string | undefined;

  // ── 1. Product variant suggestions ──────────────────────────────────────────
  let productSuggestions: FilterSuggestion[] = [];
  if (!only || only === 'product') {
  try {
    const productRows = await imsQuery<{
      variant_id: string;
      sku: string | null;
      barcode: string | null;
      product_name: string;
      brand: string | null;
      option_label: string | null;
    }>(`
      SELECT
        v.variant_id,
        v.sku,
        v.barcode,
        p.name AS product_name,
        p.brand,
        TRIM(BOTH ' / ' FROM CONCAT_WS(' / ',
          NULLIF(TRIM(COALESCE(v.option1_value,'')), ''),
          NULLIF(TRIM(COALESCE(v.option2_value,'')), ''),
          NULLIF(TRIM(COALESCE(v.option3_value,'')), '')
        )) AS option_label
      FROM ims_product_variants v
      JOIN ims_products p ON p.product_id = v.product_id
      WHERE v.is_active = 1
        AND p.is_active = 1
        ${businessId ? 'AND p.business_id = ?' : ''}
        AND (
          v.sku      LIKE ? OR
          v.barcode  LIKE ? OR
          p.name     LIKE ?
        )
      ORDER BY p.name, v.sku
      LIMIT ${limit}
    `, businessId ? [businessId, like, like, like] : [like, like, like]);

    productSuggestions = productRows.map(r => {

    productSuggestions = productRows.map(r => {
      const nameParts = [r.product_name, r.option_label].filter(Boolean);
      const label = `Product: ${nameParts.join(' — ')}  ·  Brand: ${r.brand ?? '—'}`;
      const metaParts: string[] = [];
      if (r.sku) metaParts.push(`SKU: ${r.sku}`);
      if (r.barcode) metaParts.push(`Barcode: ${r.barcode}`);
      return {
        type: 'product' as const,
        value: r.variant_id,
        label,
        meta: metaParts.join('  ·  ') || undefined,
      };
    });
  } catch { /* skip */ }
  } // end only product

  // ── 2. Brand suggestions ──────────────────────────────────────────────────
  let brandSuggestions: FilterSuggestion[] = [];
  if (!only || only === 'brand') {
  try {
    const brandRows = await imsQuery<{ brand: string }>(`
      SELECT DISTINCT brand
      FROM ims_products
      WHERE is_active = 1
        AND brand IS NOT NULL
        AND brand != ''
        AND brand LIKE ?
      ORDER BY CASE WHEN brand LIKE ? THEN 0 ELSE 1 END, brand
      LIMIT ?
    `, [like, exactLike, limit]);
    brandSuggestions = brandRows.map(r => ({
      type: 'brand' as const,
      value: r.brand,
      label: `Brand: ${r.brand}`,
      meta: 'Filter all products from this brand',
    }));
  } catch { /* skip */ }
  } // end only brand

  // ── 3. Supplier suggestions ───────────────────────────────────────────────
  let supplierSuggestions: FilterSuggestion[] = [];
  if (!only || only === 'supplier') {
  try {
    const supplierRows = await imsQuery<{ id: number; name: string }>(`
      SELECT DISTINCT c.id, c.name
      FROM ims_contacts c
      JOIN ims_products p ON p.supplier_contact_id = c.id AND p.is_active = 1
      WHERE c.is_active = 1
        AND c.name LIKE ?
      ORDER BY CASE WHEN c.name LIKE ? THEN 0 ELSE 1 END, c.name
      LIMIT ?
    `, [like, exactLike, limit]);
    supplierSuggestions = supplierRows.map(r => ({
      type: 'supplier' as const,
      value: String(r.id),
      label: `Supplier: ${r.name}`,
      meta: 'Filter all products from this supplier',
    }));
  } catch { /* supplier_contact_id column not yet added — skip */ }
  } // end only supplier
      value: String(r.id),
      label: `Supplier: ${r.name}`,
      meta: 'Filter all products from this supplier',
    }));
  } catch { /* supplier_contact_id column not yet added — skip */ }

  // ── 4. Product Type suggestions ───────────────────────────────────────────
  let typeSuggestions: FilterSuggestion[] = [];
  try {
    const typeRows = await imsQuery<{ product_type: string }>(`
      SELECT DISTINCT product_type
      FROM ims_products
      WHERE is_active = 1
        AND product_type IS NOT NULL
        AND product_type != ''
        AND product_type LIKE ?
      ORDER BY CASE WHEN product_type LIKE ? THEN 0 ELSE 1 END, product_type
      LIMIT ?
    `, [like, exactLike, Math.ceil(limit / 3)]);
    typeSuggestions = typeRows.map(r => ({
      type: 'product_type' as const,
      value: r.product_type,
      label: `Product Type: ${r.product_type}`,
      meta: 'Filter all products of this type',
    }));
  } catch { /* skip */ }

  try {
    // When `only` is set, skip the other categories entirely
    const wantSupplier    = !only || only === 'supplier';
    const wantBrand       = !only || only === 'brand';
    const wantType        = !only || only === 'product_type';
    const wantProduct     = !only || only === 'product';
    const perType = only ? limit : Math.ceil(limit / 3);

    const suggestions: FilterSuggestion[] = [
      ...(wantSupplier ? supplierSuggestions : []),
      ...(wantBrand    ? brandSuggestions    : []),
      ...(wantType     ? typeSuggestions     : []),
      ...(wantProduct  ? productSuggestions  : []),
    ].slice(0, limit);

    return NextResponse.json({ suggestions });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
