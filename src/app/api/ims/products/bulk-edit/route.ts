import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

// ─── GET /api/ims/products/bulk-edit ─────────────────────────────────────────
// Query params:
//   location_id  (required)
//   page         default 1
//   q            text search on name / sku / brand
//   filter       "new" | "no_min" | "no_reorder" | "no_zone" | "no_bin"
//   brand        exact brand name
//   supplier     supplier_contact_id (numeric)
export async function GET(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const locationId  = parseInt(searchParams.get('location_id') ?? '0', 10);
  const page        = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const perPage     = 50;
  const offset      = (page - 1) * perPage;
  const q           = (searchParams.get('q') ?? '').trim();
  const quickFilter = searchParams.get('filter') ?? '';  // new|no_min|no_reorder|no_zone|no_bin
  const brandFilter = (searchParams.get('brand') ?? '').trim();
  const supplierFilter = searchParams.get('supplier') ?? '';

  if (!locationId) return NextResponse.json({ error: 'location_id is required' }, { status: 400 });

  // Build WHERE conditions
  const whereParts: string[] = ['p.is_active = 1'];
  const whereParams: any[]   = [];

  if (q) {
    whereParts.push('(p.name LIKE ? OR p.brand LIKE ? OR EXISTS (SELECT 1 FROM ims_product_variants v2 WHERE v2.product_id = p.product_id AND v2.sku LIKE ?))');
    const like = `%${q}%`;
    whereParams.push(like, like, like);
  }
  if (brandFilter) {
    whereParts.push('p.brand = ?');
    whereParams.push(brandFilter);
  }
  if (supplierFilter) {
    whereParts.push('p.supplier_contact_id = ?');
    whereParams.push(parseInt(supplierFilter, 10));
  }
  if (quickFilter === 'new') {
    whereParts.push("p.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
  }
  if (quickFilter === 'no_zone') {
    whereParts.push("(p.zone IS NULL OR p.zone = '')");
  }
  if (quickFilter === 'no_bin') {
    whereParts.push("(p.bin IS NULL OR p.bin = '')");
  }

  const whereSQL = whereParts.join(' AND ');

  // HAVING conditions (require GROUP BY aggregates)
  const havingParts: string[] = [];
  if (quickFilter === 'no_min') {
    havingParts.push('COALESCE(MIN(s.min_qty), 0) = 0');
  }
  if (quickFilter === 'no_reorder') {
    havingParts.push('COALESCE(MIN(s.reorder_qty), 0) = 0');
  }
  const havingSQL = havingParts.length ? `HAVING ${havingParts.join(' AND ')}` : '';

  const baseQuery = `
    FROM ims_products p
    LEFT JOIN ims_contacts c ON c.id = p.supplier_contact_id
    LEFT JOIN ims_product_variants v ON v.product_id = p.product_id AND v.is_active = 1
    LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
    WHERE ${whereSQL}
    GROUP BY p.product_id, p.name, p.brand, p.zone, p.bin, p.supplier_contact_id, p.created_at, c.name
    ${havingSQL}
  `;

  const countParams  = [locationId, ...whereParams];
  const selectParams = [locationId, ...whereParams];

  try {
    // Total count
    const [{ total }] = await imsQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM (SELECT p.product_id ${baseQuery}) _cnt`,
      countParams,
    );

    // Page data — LIMIT/OFFSET inlined as integers (not ?-params) to avoid a
    // mysql2 prepared-statement serialisation issue with LIMIT/OFFSET parameters.
    const rows = await imsQuery<{
      product_id: string;
      name: string;
      brand: string | null;
      zone: string | null;
      bin: string | null;
      supplier_contact_id: number | null;
      supplier_name: string | null;
      created_at: string | null;
      min_qty: number | null;
      reorder_qty: number | null;
      variant_count: number;
    }>(
      `SELECT
         p.product_id,
         p.name,
         p.brand,
         p.zone,
         p.bin,
         p.supplier_contact_id,
         c.name AS supplier_name,
         p.created_at,
         COALESCE(MIN(s.min_qty), 0) AS min_qty,
         COALESCE(MIN(s.reorder_qty), 0) AS reorder_qty,
         COUNT(DISTINCT v.variant_id) AS variant_count
       ${baseQuery}
       ORDER BY p.created_at DESC
       LIMIT ${perPage} OFFSET ${offset}`,
      selectParams,
    );

    // Fetch variants for each product — include zone/bin from ims_stock at the selected location
    const productsWithVariants = await Promise.all(rows.map(async (product) => {
      const variants = await imsQuery<{
        variant_id: string;
        sku: string;
        barcode: string | null;
        zone: string | null;
        bin: string | null;
      }>(
        `SELECT v.variant_id, v.sku, v.barcode,
                s.zone, s.bin
         FROM ims_product_variants v
         LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
         WHERE v.product_id = ? AND v.is_active = 1
         ORDER BY v.sku ASC`,
        [locationId, product.product_id],
      );
      return { ...product, variants };
    }));

    return NextResponse.json({ products: productsWithVariants, total, page, perPage });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── PUT /api/ims/products/bulk-edit ─────────────────────────────────────────
// Body: { location_id: number, updates: Array<{ product_id, name?, barcode?, brand?,
//   supplier_contact_id?, zone?, bin?, min_qty?, reorder_qty?, variant_overrides? }> }
export async function PUT(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const { location_id, updates } = await req.json() as {
      location_id: number;
      updates: Array<{
        product_id: string;
        name?: string;
        barcode?: string | null;
        brand?: string | null;
        supplier_contact_id?: number | null;
        zone?: string | null;
        bin?: string | null;
        min_qty?: number | null;
        reorder_qty?: number | null;
        variant_overrides?: Array<{
          variant_id: string;
          barcode?: string | null;
          zone?: string | null;
          bin?: string | null;
        }>;
      }>;
    };

    if (!location_id || !Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: 'location_id and updates[] are required' }, { status: 400 });
    }

    let productUpdates = 0;
    let stockUpdates = 0;
    let variantUpdates = 0;

    for (const u of updates) {
      if (!u.product_id) continue;

      // ── Product-level fields ───────────────────────────────────────────────
      const productFields: string[] = [];
      const productValues: any[]    = [];

      if (u.name !== undefined) {
        const trimmed = (u.name ?? '').trim();
        if (trimmed) { productFields.push('name = ?'); productValues.push(trimmed); }
      }
      if ('brand' in u) {
        productFields.push('brand = ?');
        productValues.push(u.brand || null);
      }
      if ('supplier_contact_id' in u) {
        productFields.push('supplier_contact_id = ?');
        productValues.push(u.supplier_contact_id ?? null);
      }

      if (productFields.length > 0) {
        productFields.push('updated_at = CURRENT_TIMESTAMP');
        await imsExecute(
          `UPDATE ims_products SET ${productFields.join(', ')} WHERE product_id = ?`,
          [...productValues, u.product_id],
        );
        productUpdates++;
      }

      // ── Apply product-level barcode to single variant ─────────────────────
      if ('barcode' in u) {
        const variantIds = await imsQuery<{ variant_id: string }>(
          'SELECT variant_id FROM ims_product_variants WHERE product_id = ? AND is_active = 1',
          [u.product_id],
        );

        // Only apply product-level barcode to single variant products
        if (variantIds.length === 1) {
          await imsExecute(
            `UPDATE ims_product_variants SET barcode = ? WHERE variant_id = ?`,
            [u.barcode || null, variantIds[0].variant_id],
          );
          variantUpdates++;
        }
      }

      // ── Apply variant-level overrides ──────────────────────────────────────
      if (u.variant_overrides && u.variant_overrides.length > 0) {
        for (const override of u.variant_overrides) {
          // Barcode → ims_product_variants
          if ('barcode' in override) {
            await imsExecute(
              `UPDATE ims_product_variants SET barcode = ? WHERE variant_id = ?`,
              [override.barcode ?? null, override.variant_id],
            );
            variantUpdates++;
          }
          // Zone/Bin → ims_stock at the chosen location
          if ('zone' in override || 'bin' in override) {
            const zoneVal = 'zone' in override ? (override.zone ?? null) : undefined;
            const binVal  = 'bin'  in override ? (override.bin  ?? null) : undefined;
            const setClauses: string[] = [];
            const setVals: any[] = [];
            if (zoneVal !== undefined) { setClauses.push('zone = ?'); setVals.push(zoneVal); }
            if (binVal  !== undefined) { setClauses.push('bin = ?');  setVals.push(binVal); }
            await imsExecute(
              `INSERT INTO ims_stock (variant_id, location_id, zone, bin)
               VALUES (?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE ${setClauses.join(', ')}`,
              [override.variant_id, location_id, zoneVal ?? null, binVal ?? null, ...setVals],
            );
            stockUpdates++;
          }
        }
      }

      // ── Stock-level fields (applied to all active variants of the product) ─
      if (u.min_qty !== undefined || u.reorder_qty !== undefined) {
        const variantIds = await imsQuery<{ variant_id: string }>(
          'SELECT variant_id FROM ims_product_variants WHERE product_id = ? AND is_active = 1',
          [u.product_id],
        );

        // Pass null (not 0) for whichever field was not provided, so COALESCE keeps
        // the existing DB value instead of overwriting it with zero.
        const minQty     = u.min_qty     !== undefined ? u.min_qty     : null;
        const reorderQty = u.reorder_qty !== undefined ? u.reorder_qty : null;

        for (const { variant_id } of variantIds) {
          await imsExecute(
            `INSERT INTO ims_stock (variant_id, location_id, min_qty, reorder_qty)
             VALUES (?, ?, COALESCE(?,0), COALESCE(?,0))
             ON DUPLICATE KEY UPDATE
               min_qty     = COALESCE(VALUES(min_qty),     min_qty),
               reorder_qty = COALESCE(VALUES(reorder_qty), reorder_qty)`,
            [variant_id, location_id, minQty, reorderQty],
          );
          stockUpdates++;
        }
      }
    }

    return NextResponse.json({ ok: true, productUpdates, stockUpdates, variantUpdates });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
