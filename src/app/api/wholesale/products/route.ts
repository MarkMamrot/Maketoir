/**
 * GET /api/wholesale/products
 *
 * Returns active products that have at least one variant with wholesale_price > 0,
 * including stock levels summed across all locations.
 *
 * Query params:
 *   browse_mode: 'category' | 'product_type'  (default: category)
 *   category:     filter by category
 *   subcategory:  filter by subcategory
 *   product_type: filter by product_type
 */
import { NextResponse } from 'next/server';
import { requireWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { enterImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery } from '@/services/IMSMySQLService';

export async function GET(req: Request) {
  const { session, response } = requireWholesaleSession();
  if (response) return response;

  await enterImsForBusiness(session.businessId);

  const { searchParams } = new URL(req.url);
  const category     = searchParams.get('category')     ?? '';
  const subcategory  = searchParams.get('subcategory')  ?? '';
  const productType  = searchParams.get('product_type') ?? '';

  try {
    // Build WHERE clauses
    const conditions: string[] = [
      'p.is_active = 1',
      'p.business_id = ?',
      // must have at least one variant with a wholesale price > 0
      `EXISTS (
         SELECT 1 FROM ims_product_variants v2
         WHERE v2.product_id = p.product_id
           AND v2.is_active = 1
           AND v2.price_wholesale > 0
       )`,
    ];
    const params: any[] = [session.businessId];

    if (category)    { conditions.push('p.category = ?');    params.push(category); }
    if (subcategory) { conditions.push('p.subcategory = ?'); params.push(subcategory); }
    if (productType) { conditions.push('p.product_type = ?'); params.push(productType); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    // ── Products ──────────────────────────────────────────────────────────────
    const products = await imsQuery<{
      id: number; product_id: string; name: string; description: string | null;
      product_type: string | null; brand: string | null; category: string | null;
      subcategory: string | null; allow_indent_wholesale: number; created_at: string;
    }>(
      `SELECT p.id, p.product_id, p.name, p.description, p.product_type,
              p.brand, p.category, p.subcategory, p.allow_indent_wholesale, p.created_at
       FROM ims_products p
       ${where}
       ORDER BY p.created_at DESC`,
      params,
    );

    if (products.length === 0) {
      return NextResponse.json({ success: true, products: [] });
    }

    const productIds = products.map(p => p.product_id);
    const placeholders = productIds.map(() => '?').join(',');

    // ── Variants (wholesale price > 0 only) ──────────────────────────────────
    const variants = await imsQuery<{
      id: number; variant_id: string; product_id: string; sku: string | null; barcode: string | null;
      option1_value: string | null; option2_value: string | null; option3_value: string | null;
      price_wholesale: number; pack_size: number | null;
    }>(
      `SELECT id, variant_id, product_id, sku, barcode,
              option1_value, option2_value, option3_value,
              price_wholesale, pack_size
       FROM ims_product_variants
       WHERE product_id IN (${placeholders})
         AND is_active = 1
         AND price_wholesale > 0
       ORDER BY sku`,
      productIds,
    );

    // ── Stock: sum qty_on_hand - qty_committed per variant across all locations ─
    const variantIds = variants.map(v => v.variant_id);
    const stockMap: Record<string, number> = {};
    if (variantIds.length > 0) {
      const variantPlaceholders = variantIds.map(() => '?').join(',');
      const stockRows = await imsQuery<{
        variant_id: string;
        available: number;
      }>(
        `SELECT variant_id,
                GREATEST(0, SUM(qty_on_hand) - SUM(COALESCE(qty_committed,0))) AS available
         FROM ims_stock
         WHERE variant_id IN (${variantPlaceholders})
         GROUP BY variant_id`,
        variantIds,
      );
      for (const s of stockRows) stockMap[s.variant_id] = Number(s.available);
    }

    // ── Primary images ─────────────────────────────────────────────────────
    let imageMap: Record<string, string> = {};
    try {
      const imgRows = await imsQuery<{ product_id: string; url: string }>(
        `SELECT p.product_id,
           (SELECT url FROM ims_product_images
            WHERE product_id = p.product_id
            ORDER BY is_primary DESC, sort_order ASC LIMIT 1) AS url
         FROM ims_products p
         WHERE p.product_id IN (${placeholders})
         HAVING url IS NOT NULL`,
        productIds,
      );
      for (const r of imgRows) imageMap[r.product_id] = r.url;
    } catch { /* images table may not exist */ }

    // ── Assemble ──────────────────────────────────────────────────────────────
    const variantsByProduct: Record<string, typeof variants> = {};
    for (const v of variants) {
      if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = [];
      variantsByProduct[v.product_id].push(v);
    }

    const result = products
      .map(p => {
        const pvs = (variantsByProduct[p.product_id] ?? []).map(v => ({
          ...v,
          available: stockMap[v.variant_id] ?? 0,
        }));
        if (pvs.length === 0) return null; // safety: skip if no eligible variants
        return {
          ...p,
          image_url: imageMap[p.product_id] ?? null,
          variants: pvs,
        };
      })
      .filter(Boolean);

    // ── Aggregated filter facets ──────────────────────────────────────────────
    const categories = await imsQuery<{ category: string; subcategory: string | null }>(
      `SELECT DISTINCT category, subcategory
       FROM ims_products
       WHERE is_active = 1 AND business_id = ? AND category IS NOT NULL AND category != ''
         AND EXISTS (
           SELECT 1 FROM ims_product_variants v2
           WHERE v2.product_id = ims_products.product_id
             AND v2.is_active = 1 AND v2.price_wholesale > 0
         )
       ORDER BY category, subcategory`,
      [session.businessId],
    );

    const productTypes = await imsQuery<{ product_type: string }>(
      `SELECT DISTINCT product_type
       FROM ims_products
       WHERE is_active = 1 AND business_id = ? AND product_type IS NOT NULL AND product_type != ''
         AND EXISTS (
           SELECT 1 FROM ims_product_variants v2
           WHERE v2.product_id = ims_products.product_id
             AND v2.is_active = 1 AND v2.price_wholesale > 0
         )
       ORDER BY product_type`,
      [session.businessId],
    );

    return NextResponse.json({
      success: true,
      products: result,
      facets: {
        categories,
        productTypes: productTypes.map(r => r.product_type),
      },
    });
  } catch (e: any) {
    console.error('[wholesale/products]', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
