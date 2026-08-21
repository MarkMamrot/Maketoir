import { NextResponse } from 'next/server';
import { getIMSPool } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const SALES_LINES = `
  SELECT COALESCE(hvid.variant_id, hsku.variant_id, hopt.variant_id) AS variant_id,
         hl.id AS location_id, h.qty, h.line_total AS amount
    FROM ims_sales_history h
    LEFT JOIN ims_product_variants hvid ON hvid.variant_id = h.variant_id
    LEFT JOIN ims_product_variants hsku ON hvid.variant_id IS NULL AND hsku.sku = h.sku
    LEFT JOIN ims_product_variants hopt ON hvid.variant_id IS NULL AND hsku.variant_id IS NULL AND hopt.cin7_option_id = h.cin7_option_id
    LEFT JOIN ims_locations hl ON hl.cin7_branch_id = h.branch_id
   WHERE h.invoice_date BETWEEN ? AND ?

  UNION ALL

  SELECT COALESCE(pvid.variant_id, psku.variant_id) AS variant_id,
         ps.location_id, psi.qty, psi.line_total AS amount
    FROM pos_sale_items psi
    JOIN pos_sales ps ON ps.id = psi.sale_id
    LEFT JOIN ims_product_variants pvid ON pvid.variant_id = psi.variant_id
    LEFT JOIN ims_product_variants psku ON pvid.variant_id IS NULL AND psku.sku = psi.code
   WHERE ps.status = 'completed' AND ps.sale_type = 'sale' AND ps.is_historical = 0
     AND DATE(ps.completed_at) BETWEEN ? AND ?

  UNION ALL

  SELECT COALESCE(svid.variant_id, ssku.variant_id) AS variant_id,
         so.location_id, soi.qty_ordered AS qty, soi.line_total AS amount
    FROM ims_sales_order_items soi
    JOIN ims_sales_orders so ON so.id = soi.so_id
    LEFT JOIN ims_product_variants svid ON svid.variant_id = soi.variant_id
    LEFT JOIN ims_product_variants ssku ON svid.variant_id IS NULL AND ssku.sku = soi.code
  WHERE so.status NOT IN ('draft', 'cancelled') AND so.is_staff_preview_test = 0 AND so.cin7_order_id IS NULL
     AND so.order_date BETWEEN ? AND ?`;

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string | undefined;

  const { searchParams } = new URL(req.url);
  const brand = searchParams.get('brand') ?? '';
  const supplierId = searchParams.get('supplierId') ?? '';
  const supplierName = searchParams.get('supplierName') ?? '';
  const productType = searchParams.get('productType') ?? '';
  const productId = searchParams.get('productId') ?? '';
  const q = (searchParams.get('q') ?? '').trim();
  const category = searchParams.get('category') ?? '';
  const subcategory = searchParams.get('subcategory') ?? '';
  const windowDays = Math.min(3650, Math.max(1, parseInt(searchParams.get('window') ?? '90', 10)));
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') ?? '25', 10)));
  const offset = (page - 1) * pageSize;
  const fromParam = searchParams.get('from') ?? '';
  const toParam = searchParams.get('to') ?? '';
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const toDate = datePattern.test(toParam) ? toParam : isoDate(new Date());
  const fromDate = datePattern.test(fromParam)
    ? fromParam
    : isoDate(new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000));
  const locationIds = (searchParams.get('locationIds') ?? '')
    .split(',')
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0);

  try {
    const pool = getIMSPool();
    const dateParams = [fromDate, toDate, fromDate, toDate, fromDate, toDate];
    const productConditions: string[] = ['v.is_active = 1', 'p.is_active = 1'];
    const productParams: Array<string | number> = [];
    if (businessId) { productConditions.push('p.business_id = ?'); productParams.push(businessId); }
    if (productId) { productConditions.push('v.variant_id = ?'); productParams.push(productId); }
    for (const word of q.split(/\s+/).filter(Boolean)) {
      productConditions.push('(p.name LIKE ? OR v.sku LIKE ?)');
      productParams.push(`%${word}%`, `%${word}%`);
    }
    if (brand) { productConditions.push('p.brand LIKE ?'); productParams.push(`%${brand}%`); }
    if (supplierId) { productConditions.push('p.supplier_contact_id = ?'); productParams.push(Number(supplierId)); }
    if (supplierName) { productConditions.push('con.name LIKE ?'); productParams.push(`%${supplierName}%`); }
    if (productType) { productConditions.push('p.product_type LIKE ?'); productParams.push(`%${productType}%`); }
    if (category) { productConditions.push('p.category = ?'); productParams.push(category); }
    if (subcategory) { productConditions.push('p.subcategory = ?'); productParams.push(subcategory); }
    const productWhere = `WHERE ${productConditions.join(' AND ')}`;

    const locationPlaceholders = locationIds.map(() => '?').join(',');
    const salesLocationWhere = locationIds.length > 0 ? `WHERE s.location_id IN (${locationPlaceholders})` : '';
    const salesAggregate = `
      SELECT s.variant_id,
             SUM(s.qty) AS sales_qty,
             SUM(s.amount) AS sales_amount
        FROM (${SALES_LINES}) s
        ${salesLocationWhere}
       GROUP BY s.variant_id`;

    const [[countRow]] = await pool.query<any>(
      `SELECT COUNT(*) AS total
         FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
         LEFT JOIN ims_contacts con ON con.id = p.supplier_contact_id
         ${productWhere}`,
      productParams,
    ) as any;

    const [rows] = await pool.query<any>(
      `SELECT v.variant_id, v.sku,
              TRIM(BOTH ' / ' FROM CONCAT_WS(' / ',
                NULLIF(TRIM(COALESCE(v.option1_value, '')), ''),
                NULLIF(TRIM(COALESCE(v.option2_value, '')), ''),
                NULLIF(TRIM(COALESCE(v.option3_value, '')), '')
              )) AS option_label,
              p.name AS product_name, p.brand,
              con.name AS supplier_name, con.id AS supplier_id,
              COALESCE(sa.sales_qty, 0) AS sales_qty,
              COALESCE(sa.sales_amount, 0) AS sales_amount
         FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
         LEFT JOIN ims_contacts con ON con.id = p.supplier_contact_id
         LEFT JOIN (${salesAggregate}) sa ON sa.variant_id = v.variant_id
         ${productWhere}
        ORDER BY sales_qty DESC, sales_amount DESC, p.name, COALESCE(v.sku, '')
        LIMIT ? OFFSET ?`,
      [...dateParams, ...locationIds, ...productParams, pageSize, offset],
    ) as any;

    const totalsConditions = [...productConditions];
    if (locationIds.length > 0) totalsConditions.push(`s.location_id IN (${locationPlaceholders})`);
    const [locationTotals] = await pool.query<any>(
      `SELECT s.location_id,
              COALESCE(SUM(s.qty), 0) AS sales_qty,
              COALESCE(SUM(s.amount), 0) AS sales_amount
         FROM (${SALES_LINES}) s
         JOIN ims_product_variants v ON v.variant_id = s.variant_id
         JOIN ims_products p ON p.product_id = v.product_id
         LEFT JOIN ims_contacts con ON con.id = p.supplier_contact_id
        WHERE ${totalsConditions.join(' AND ')}
        GROUP BY s.location_id`,
      [...dateParams, ...productParams, ...locationIds],
    ) as any;

    const variantIds: string[] = rows.map((row: any) => row.variant_id);
    const salesByVariant: Record<string, Array<{ location_id: number; sales_qty: number; sales_amount: number }>> = {};
    if (variantIds.length > 0) {
      const variantPlaceholders = variantIds.map(() => '?').join(',');
      const pageLocationCondition = locationIds.length > 0 ? `AND s.location_id IN (${locationPlaceholders})` : '';
      const [branchRows] = await pool.query<any>(
        `SELECT s.variant_id, s.location_id,
                SUM(s.qty) AS sales_qty,
                SUM(s.amount) AS sales_amount
           FROM (${SALES_LINES}) s
          WHERE s.variant_id IN (${variantPlaceholders})
            ${pageLocationCondition}
          GROUP BY s.variant_id, s.location_id`,
        [...dateParams, ...variantIds, ...locationIds],
      ) as any;
      for (const row of branchRows) {
        if (!salesByVariant[row.variant_id]) salesByVariant[row.variant_id] = [];
        salesByVariant[row.variant_id].push({
          location_id: Number(row.location_id),
          sales_qty: Number(row.sales_qty ?? 0),
          sales_amount: Number(row.sales_amount ?? 0),
        });
      }
    }

    const [locations] = await pool.query<any>('SELECT id, name FROM ims_locations WHERE is_active = 1 ORDER BY name') as any;
    const [brands] = await pool.query<any>(
      `SELECT DISTINCT brand FROM ims_products WHERE brand IS NOT NULL AND brand != '' AND is_active = 1 ORDER BY brand`,
    ) as any;
    const [suppliers] = await pool.query<any>(
      `SELECT DISTINCT c.id, c.name
         FROM ims_contacts c
         JOIN ims_products p ON p.supplier_contact_id = c.id
        WHERE p.is_active = 1 AND c.is_active = 1
        ORDER BY c.name`,
    ) as any;

    const totalQty = locationTotals.reduce((sum: number, row: any) => sum + Number(row.sales_qty ?? 0), 0);
    const totalAmount = locationTotals.reduce((sum: number, row: any) => sum + Number(row.sales_amount ?? 0), 0);

    return NextResponse.json({
      success: true,
      rows: rows.map((row: any) => ({
        variant_id: row.variant_id,
        sku: row.sku ?? '',
        option_label: row.option_label ?? '',
        product_name: row.product_name ?? '',
        brand: row.brand ?? '',
        supplier_name: row.supplier_name ?? '',
        supplier_id: row.supplier_id ?? null,
        sales_qty: Number(row.sales_qty ?? 0),
        sales_amount: Number(row.sales_amount ?? 0),
        location_sales: salesByVariant[row.variant_id] ?? [],
      })),
      total: Number(countRow.total),
      totalQty,
      totalAmount,
      locationTotals: locationTotals.map((row: any) => ({
        location_id: Number(row.location_id),
        sales_qty: Number(row.sales_qty ?? 0),
        sales_amount: Number(row.sales_amount ?? 0),
      })),
      page,
      pageSize,
      locations: locations.map((location: any) => ({ id: Number(location.id), name: location.name })),
      fromDate,
      toDate,
      brands: brands.map((row: any) => row.brand),
      suppliers: suppliers.map((row: any) => ({ id: row.id, name: row.name })),
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims-reports',
      operation: 'sales-by-branch',
      title: 'Sales by branch report failed',
      error,
      context: { fromDate, toDate, locationIds, page, pageSize },
    });
    const message = error instanceof Error ? error.message : 'Failed to load sales report';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
