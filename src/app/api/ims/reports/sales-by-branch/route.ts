import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIMSPool } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(req: Request) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  // Unified combobox filter (takes precedence over legacy params)
  const filterType  = searchParams.get('filterType')  ?? '';
  const filterValue = searchParams.get('filterValue') ?? '';
  // Legacy params kept for backward compat
  const brand      = filterType === 'brand'    ? filterValue : (searchParams.get('brand')    ?? '');
  const supplierId = filterType === 'supplier' ? filterValue : (searchParams.get('supplier') ?? '');
  const search     = filterType === '' ? (searchParams.get('search') ?? '') : '';
  const win        = parseInt(searchParams.get('window') ?? '90');
  const page       = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const pageSize   = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') ?? '25')));
  const offset     = (page - 1) * pageSize;

  try {
    const pool = getIMSPool();

    // Build WHERE clause
    const conds: string[] = ['v.is_active = 1', 'p.is_active = 1'];
    const params: any[]   = [];
    if (filterType === 'product' && filterValue) {
      conds.push('v.variant_id = ?');
      params.push(filterValue);
    } else if (filterType === 'product_type' && filterValue) {
      conds.push('p.product_type = ?');
      params.push(filterValue);
    } else {
      if (brand)      { conds.push('p.brand = ?');               params.push(brand); }
      if (supplierId) { conds.push('p.supplier_contact_id = ?'); params.push(Number(supplierId)); }
      if (search) {
        conds.push('(p.name LIKE ? OR v.sku LIKE ? OR p.brand LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like);
      }
    }
    const where = 'WHERE ' + conds.join(' AND ');

    // Sales column for the selected window
    const salesCol =
      win <=  7 ? 'sc.sales_qty_7d'   :
      win <= 90 ? 'sc.sales_qty_90d'  :
      win <= 180? 'sc.sales_qty_180d' : 'sc.sales_qty_12m';

    // 1. Total count
    const [[countRow]] = await pool.query<any>(
      `SELECT COUNT(*) AS total
       FROM ims_product_variants v
       JOIN  ims_products p ON p.product_id = v.product_id
       ${where}`,
      params,
    ) as any;

    // 2. Paginated product rows
    const [rows] = await pool.query<any>(
      `SELECT
         v.variant_id, v.sku, v.barcode, v.pack_size,
         TRIM(BOTH ' / ' FROM CONCAT_WS(' / ',
           NULLIF(TRIM(COALESCE(v.option1_value,'')), ''),
           NULLIF(TRIM(COALESCE(v.option2_value,'')), ''),
           NULLIF(TRIM(COALESCE(v.option3_value,'')), '')
         )) AS option_label,
         p.name AS product_name, p.brand, p.style_code,
         con.name AS supplier_name, con.id AS supplier_id,
         COALESCE(sc.sales_qty_7d,   0) AS sales_qty_7d,
         COALESCE(sc.sales_qty_90d,  0) AS sales_qty_90d,
         COALESCE(sc.sales_qty_180d, 0) AS sales_qty_180d,
         COALESCE(sc.sales_qty_12m,  0) AS sales_qty_12m,
         COALESCE(sc.global_soh,       0) AS global_soh,
         COALESCE(sc.global_available, 0) AS global_available,
         COALESCE(sc.global_incoming,  0) AS global_incoming
       FROM ims_product_variants v
       JOIN  ims_products    p   ON p.product_id        = v.product_id
       LEFT JOIN ims_contacts con ON con.id             = p.supplier_contact_id
       LEFT JOIN ims_sales_cache sc ON sc.variant_id   = v.variant_id
       ${where}
       ORDER BY ${salesCol} DESC, p.name, COALESCE(v.sku, '')
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    ) as any;

    // 3. Per-location stock for the current page variants
    const variantIds: string[] = rows.map((r: any) => r.variant_id);
    const stockByVariant: Record<string, any[]> = {};
    let locations: Array<{ id: number; name: string }> = [];

    if (variantIds.length > 0) {
      const ph = variantIds.map(() => '?').join(',');
      const [stockRows] = await pool.query<any>(
        `SELECT s.variant_id, s.qty_on_hand, s.qty_incoming, s.qty_committed,
                l.id AS location_id, l.name AS location_name
         FROM   ims_stock s
         JOIN   ims_locations l ON l.id = s.location_id AND l.is_active = 1
         WHERE  s.variant_id IN (${ph})
         ORDER BY l.name`,
        variantIds,
      ) as any;

      const locMap = new Map<number, string>();
      for (const s of stockRows) {
        if (!stockByVariant[s.variant_id]) stockByVariant[s.variant_id] = [];
        stockByVariant[s.variant_id].push({
          location_id:   s.location_id,
          location_name: s.location_name,
          soh:      Number(s.qty_on_hand),
          available: Number(s.qty_on_hand) - Number(s.qty_committed),
          incoming:  Number(s.qty_incoming),
        });
        locMap.set(s.location_id, s.location_name);
      }
      locations = Array.from(locMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    // 4. Filter options (fetched once from unfiltered data)
    const [brands] = await pool.query<any>(
      `SELECT DISTINCT brand FROM ims_products WHERE brand IS NOT NULL AND brand != '' AND is_active = 1 ORDER BY brand`,
    ) as any;
    const [suppliers] = await pool.query<any>(
      `SELECT DISTINCT c.id, c.name
       FROM   ims_contacts c
       JOIN   ims_products p ON p.supplier_contact_id = c.id
       WHERE  p.is_active = 1 AND c.is_active = 1
       ORDER BY c.name`,
    ) as any;

    const data = rows.map((r: any) => ({
      variant_id:      r.variant_id,
      sku:             r.sku ?? '',
      option_label:    r.option_label ?? '',
      product_name:    r.product_name ?? '',
      brand:           r.brand ?? '',
      supplier_name:   r.supplier_name ?? '',
      supplier_id:     r.supplier_id ?? null,
      sales_qty_7d:    Number(r.sales_qty_7d),
      sales_qty_90d:   Number(r.sales_qty_90d),
      sales_qty_180d:  Number(r.sales_qty_180d),
      sales_qty_12m:   Number(r.sales_qty_12m),
      global_soh:      Number(r.global_soh),
      global_available:Number(r.global_available),
      global_incoming: Number(r.global_incoming),
      stock:           stockByVariant[r.variant_id] ?? [],
    }));

    return NextResponse.json({
      success:   true,
      rows:      data,
      total:     Number(countRow.total),
      page,
      pageSize,
      locations,
      brands:    brands.map((b: any) => b.brand),
      suppliers: suppliers.map((s: any) => ({ id: s.id, name: s.name })),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
