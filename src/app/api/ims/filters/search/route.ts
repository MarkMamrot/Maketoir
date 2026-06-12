import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

// ─── Auth ────────────────────────────────────────────────────────────────────
function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
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
 * GET /api/ims/filters/search?q=<text>&limit=25
 *
 * Returns mixed suggestions for the report filter combobox.
 * Order: product matches first, then brand, supplier, product_type.
 * All results are constrained to active products/variants/contacts.
 */
export async function GET(req: Request) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q     = (searchParams.get('q') ?? '').trim();
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '25', 10)));

  if (q.length < 1) return NextResponse.json({ suggestions: [] });

  const like = `%${q}%`;
  const exactLike = `${q}%`;

  try {
    // ── 1. Product variant suggestions (match on name, sku, barcode) ──────────
    // Priority: exact SKU/barcode first, then prefix name, then contains name
    const productRows = await imsQuery<{
      variant_id: string;
      sku: string | null;
      barcode: string | null;
      product_name: string;
      brand: string | null;
      product_type: string | null;
      option_label: string | null;
    }>(`
      SELECT
        v.variant_id,
        v.sku,
        v.barcode,
        p.name AS product_name,
        p.brand,
        p.product_type,
        TRIM(BOTH ' / ' FROM CONCAT_WS(' / ',
          NULLIF(TRIM(COALESCE(v.option1_value,'')), ''),
          NULLIF(TRIM(COALESCE(v.option2_value,'')), ''),
          NULLIF(TRIM(COALESCE(v.option3_value,'')), '')
        )) AS option_label
      FROM ims_product_variants v
      JOIN ims_products p ON p.product_id = v.product_id
      WHERE v.is_active = 1
        AND p.is_active = 1
        AND (
          v.sku      LIKE ? OR
          v.barcode  LIKE ? OR
          p.name     LIKE ?
        )
      ORDER BY
        CASE
          WHEN v.sku = ? OR v.barcode = ?           THEN 0
          WHEN v.sku LIKE ? OR v.barcode LIKE ?     THEN 1
          WHEN p.name LIKE ?                         THEN 2
          ELSE 3
        END,
        p.name,
        v.sku
      LIMIT ?
    `, [like, like, like, q, q, exactLike, exactLike, exactLike, limit]);

    const productSuggestions: FilterSuggestion[] = productRows.map(r => {
      const nameParts = [r.product_name, r.option_label].filter(Boolean);
      const label = `Product: ${nameParts.join(' — ')}  ·  Brand: ${r.brand ?? '—'}`;
      const metaParts: string[] = [];
      if (r.sku) metaParts.push(`SKU: ${r.sku}`);
      if (r.barcode) metaParts.push(`Barcode: ${r.barcode}`);
      if (r.product_type) metaParts.push(r.product_type);
      return {
        type: 'product',
        value: r.variant_id,
        label,
        meta: metaParts.join('  ·  ') || undefined,
      };
    });

    // ── 2. Brand suggestions ──────────────────────────────────────────────────
    const brandRows = await imsQuery<{ brand: string }>(`
      SELECT DISTINCT brand
      FROM ims_products
      WHERE is_active = 1
        AND brand IS NOT NULL
        AND brand != ''
        AND brand LIKE ?
      ORDER BY CASE WHEN brand LIKE ? THEN 0 ELSE 1 END, brand
      LIMIT ?
    `, [like, exactLike, Math.ceil(limit / 3)]);

    const brandSuggestions: FilterSuggestion[] = brandRows.map(r => ({
      type: 'brand',
      value: r.brand,
      label: `Brand: ${r.brand}`,
      meta: 'Filter all products from this brand',
    }));

    // ── 3. Supplier suggestions ───────────────────────────────────────────────
    const supplierRows = await imsQuery<{ id: number; name: string }>(`
      SELECT DISTINCT c.id, c.name
      FROM ims_contacts c
      JOIN ims_products p ON p.supplier_contact_id = c.id AND p.is_active = 1
      WHERE c.is_active = 1
        AND c.name LIKE ?
      ORDER BY CASE WHEN c.name LIKE ? THEN 0 ELSE 1 END, c.name
      LIMIT ?
    `, [like, exactLike, Math.ceil(limit / 3)]);

    const supplierSuggestions: FilterSuggestion[] = supplierRows.map(r => ({
      type: 'supplier',
      value: String(r.id),
      label: `Supplier: ${r.name}`,
      meta: 'Filter all products from this supplier',
    }));

    // ── 4. Product Type suggestions ───────────────────────────────────────────
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

    const typeSuggestions: FilterSuggestion[] = typeRows.map(r => ({
      type: 'product_type',
      value: r.product_type,
      label: `Product Type: ${r.product_type}`,
      meta: 'Filter all products of this type',
    }));

    const suggestions: FilterSuggestion[] = [
      ...supplierSuggestions,
      ...brandSuggestions,
      ...typeSuggestions,
      ...productSuggestions,
    ].slice(0, limit);

    return NextResponse.json({ suggestions });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
