import { NextResponse } from 'next/server';
import { getIMSPool } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import {
  addLocationAllRollups,
  attachedCogsMetrics,
  completeSalesSummaryCombinations,
  dayOfWeekLabel,
  hourOfDayLabel,
  parseSalesSummaryDimensions,
  type SalesSummaryDimension,
} from '@/lib/ims/salesSummary';
import { SALES_SUMMARY_LINES } from '@/lib/ims/salesSummaryQuery';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const DIMENSIONS: Record<SalesSummaryDimension, { selects: string[]; groups: string[]; keys: string[] }> = {
  location: {
    selects: ['s.location_id AS location_id', "COALESCE(l.name, 'Unknown') AS location_name"],
    groups: ['s.location_id', 'l.name'],
    keys: ['location_id', 'location_name'],
  },
  supplier: {
    selects: ['p.supplier_contact_id AS supplier_id', "COALESCE(NULLIF(con.name, ''), 'Unknown') AS supplier_name"],
    groups: ['p.supplier_contact_id', 'con.name'],
    keys: ['supplier_id', 'supplier_name'],
  },
  brand: {
    selects: ["COALESCE(NULLIF(p.brand, ''), 'Unknown') AS brand"],
    groups: ["COALESCE(NULLIF(p.brand, ''), 'Unknown')"],
    keys: ['brand'],
  },
  product_type: {
    selects: ["COALESCE(NULLIF(p.product_type, ''), 'Unknown') AS product_type"],
    groups: ["COALESCE(NULLIF(p.product_type, ''), 'Unknown')"],
    keys: ['product_type'],
  },
  day_of_week: {
    selects: ['DAYOFWEEK(s.sale_date) AS day_of_week'],
    groups: ['DAYOFWEEK(s.sale_date)'],
    keys: ['day_of_week'],
  },
  hour_of_day: {
    selects: ['s.sale_hour AS hour_of_day'],
    groups: ['s.sale_hour'],
    keys: ['hour_of_day'],
  },
};

type RawSummaryRow = Record<string, unknown> & {
  sales_qty: number;
  sales_amount: number;
  attached_cogs: number;
  covered_qty: number;
  covered_amount: number;
  current_soh: number;
};

function uniqueDomainValues(rows: RawSummaryRow[], keys: string[]): Array<Record<string, unknown>> {
  const values = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const value = Object.fromEntries(keys.map(key => [key, row[key] ?? null]));
    values.set(JSON.stringify(keys.map(key => value[key])), value);
  }
  return [...values.values()].sort((left, right) => String(left[keys.at(-1) ?? ''] ?? '').localeCompare(String(right[keys.at(-1) ?? ''] ?? ''), 'en-AU'));
}

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId ?? '');
  const { searchParams } = new URL(req.url);

  let dimensions: SalesSummaryDimension[];
  try {
    dimensions = parseSalesSummaryDimensions(searchParams.get('groupBy') ?? 'location');
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid groupBy' }, { status: 400 });
  }

  const windowDays = Math.min(3650, Math.max(1, parseInt(searchParams.get('window') ?? '90', 10)));
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const toDate = datePattern.test(searchParams.get('to') ?? '') ? String(searchParams.get('to')) : isoDate(new Date());
  const fromDate = datePattern.test(searchParams.get('from') ?? '')
    ? String(searchParams.get('from'))
    : isoDate(new Date(Date.now() - (windowDays - 1) * 86400000));
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize = Math.min(200, Math.max(10, parseInt(searchParams.get('pageSize') ?? '50', 10)));
  const requestedLocationIds = (searchParams.get('locationIds') ?? '')
    .split(',').map(Number).filter(id => Number.isInteger(id) && id > 0);

  try {
    const pool = getIMSPool();
    const [locationRows] = await pool.query<any>(
      'SELECT id, name FROM ims_locations WHERE is_active = 1 ORDER BY name',
    ) as any;
    const activeLocationIds = locationRows.map((location: any) => Number(location.id));
    const selectedLocationIds = requestedLocationIds.length > 0
      ? activeLocationIds.filter((id: number) => requestedLocationIds.includes(id))
      : activeLocationIds;
    if (selectedLocationIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one active location.' }, { status: 400 });
    }

    const dimensionSelects = dimensions.flatMap(dimension => DIMENSIONS[dimension].selects);
    const dimensionGroups = dimensions.flatMap(dimension => DIMENSIONS[dimension].groups);
    const locationPlaceholders = selectedLocationIds.map(() => '?').join(',');
    const dateParams = [fromDate, toDate, fromDate, toDate, fromDate, toDate];
    const stockByVariant = dimensions.includes('location')
      ? `SELECT variant_id, location_id, SUM(qty_on_hand) AS current_soh
           FROM ims_stock WHERE location_id IN (${locationPlaceholders})
          GROUP BY variant_id, location_id`
      : `SELECT variant_id, SUM(qty_on_hand) AS current_soh
           FROM ims_stock WHERE location_id IN (${locationPlaceholders})
          GROUP BY variant_id`;
    const stockJoin = dimensions.includes('location')
      ? 'stock.variant_id = grouped.variant_id AND stock.location_id = grouped.location_id'
      : 'stock.variant_id = grouped.variant_id';

    const groupedByVariant = `
      SELECT ${dimensionSelects.join(', ')}, s.variant_id,
             SUM(s.qty) AS sales_qty,
             SUM(s.amount) AS sales_amount,
             SUM(COALESCE(s.attached_cogs, 0)) AS attached_cogs,
             SUM(s.covered_qty) AS covered_qty,
             SUM(s.covered_amount) AS covered_amount
        FROM (${SALES_SUMMARY_LINES}) s
        JOIN ims_product_variants v ON v.variant_id = s.variant_id
        JOIN ims_products p ON p.product_id = v.product_id
        LEFT JOIN ims_contacts con ON con.id = p.supplier_contact_id
        LEFT JOIN ims_locations l ON l.id = s.location_id
       WHERE p.business_id = ? AND s.location_id IN (${locationPlaceholders})
       GROUP BY ${[...dimensionGroups, 's.variant_id'].join(', ')}`;

    const [queryRows] = await pool.query<any>(
      `SELECT ${dimensions.flatMap(dimension => DIMENSIONS[dimension].keys).map(key => `grouped.${key}`).join(', ')},
              SUM(grouped.sales_qty) AS sales_qty,
              SUM(grouped.sales_amount) AS sales_amount,
              SUM(grouped.attached_cogs) AS attached_cogs,
              SUM(grouped.covered_qty) AS covered_qty,
              SUM(grouped.covered_amount) AS covered_amount,
              SUM(COALESCE(stock.current_soh, 0)) AS current_soh
         FROM (${groupedByVariant}) grouped
         LEFT JOIN (${stockByVariant}) stock ON ${stockJoin}
        GROUP BY ${dimensions.flatMap(dimension => DIMENSIONS[dimension].keys).map(key => `grouped.${key}`).join(', ')}`,
      [...dateParams, businessId, ...selectedLocationIds, ...selectedLocationIds],
    ) as any;

    const baseRows: RawSummaryRow[] = queryRows.map((row: any) => ({
      ...row,
      sales_qty: Number(row.sales_qty ?? 0),
      sales_amount: Number(row.sales_amount ?? 0),
      attached_cogs: Number(row.attached_cogs ?? 0),
      covered_qty: Number(row.covered_qty ?? 0),
      covered_amount: Number(row.covered_amount ?? 0),
      current_soh: Number(row.current_soh ?? 0),
    }));
    const groupingKeys = dimensions.flatMap(dimension => DIMENSIONS[dimension].keys);
    const metricKeys = ['sales_qty', 'sales_amount', 'attached_cogs', 'covered_qty', 'covered_amount', 'current_soh'];
    const rolledUpRows = (dimensions.includes('location') && requestedLocationIds.length === 0
      ? addLocationAllRollups(baseRows, groupingKeys, metricKeys)
      : baseRows
    );
    const domains = dimensions.map(dimension => {
      const keys = DIMENSIONS[dimension].keys;
      if (dimension === 'day_of_week') {
        return { keys, values: [2, 3, 4, 5, 6, 7, 1].map(day => ({ day_of_week: day })) };
      }
      if (dimension === 'hour_of_day') {
        const hours: Array<number | null> = Array.from({ length: 24 }, (_, hour) => hour);
        if (baseRows.some(row => row.hour_of_day == null)) hours.push(null);
        return { keys, values: hours.map(hour => ({ hour_of_day: hour })) };
      }
      if (dimension === 'location') {
        const values = locationRows
          .filter((location: any) => selectedLocationIds.includes(Number(location.id)))
          .map((location: any) => ({ location_id: Number(location.id), location_name: location.name }));
        if (requestedLocationIds.length === 0) values.unshift({ location_id: null, location_name: 'ALL' });
        return { keys, values };
      }
      return { keys, values: uniqueDomainValues(baseRows, keys) };
    });
    const allRows = completeSalesSummaryCombinations(rolledUpRows, domains, metricKeys);
    const additiveRows = baseRows;
    const totalsBase = additiveRows.reduce((totals, row) => ({
      sales_qty: totals.sales_qty + row.sales_qty,
      sales_amount: totals.sales_amount + row.sales_amount,
      attached_cogs: totals.attached_cogs + row.attached_cogs,
      covered_qty: totals.covered_qty + row.covered_qty,
      covered_amount: totals.covered_amount + row.covered_amount,
    }), { sales_qty: 0, sales_amount: 0, attached_cogs: 0, covered_qty: 0, covered_amount: 0 });

    const [[sohTotalRow]] = await pool.query<any>(
      `SELECT COALESCE(SUM(stock.current_soh), 0) AS current_soh
         FROM (
           SELECT DISTINCT s.variant_id
             FROM (${SALES_SUMMARY_LINES}) s
             JOIN ims_product_variants v ON v.variant_id = s.variant_id
             JOIN ims_products p ON p.product_id = v.product_id
            WHERE p.business_id = ? AND s.location_id IN (${locationPlaceholders})
         ) sold
         JOIN (
           SELECT variant_id, SUM(qty_on_hand) AS current_soh
             FROM ims_stock WHERE location_id IN (${locationPlaceholders})
            GROUP BY variant_id
         ) stock ON stock.variant_id = sold.variant_id`,
      [...dateParams, businessId, ...selectedLocationIds, ...selectedLocationIds],
    ) as any;

    const shape = (row: RawSummaryRow) => ({
      ...row,
      day_of_week_label: dimensions.includes('day_of_week') ? dayOfWeekLabel(row.day_of_week == null ? null : Number(row.day_of_week)) : undefined,
      hour_of_day_label: dimensions.includes('hour_of_day') ? hourOfDayLabel(row.hour_of_day == null ? null : Number(row.hour_of_day)) : undefined,
      ...attachedCogsMetrics({
        salesAmountIncTax: row.sales_amount,
        coveredSalesAmountIncTax: row.covered_amount,
        attachedCogs: row.attached_cogs,
      }),
    });
    const totals = shape({ ...totalsBase, current_soh: Number(sohTotalRow?.current_soh ?? 0) });
    const offset = (page - 1) * pageSize;

    return NextResponse.json({
      success: true,
      rows: allRows.slice(offset, offset + pageSize).map(shape),
      total: allRows.length,
      totals,
      dimensions,
      locations: locationRows.map((location: any) => ({ id: Number(location.id), name: location.name })),
      selectedLocationIds,
      fromDate,
      toDate,
      page,
      pageSize,
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims-reports',
      operation: 'sales-summary',
      title: 'Sales summary report failed',
      error,
      context: { dimensions, fromDate, toDate, requestedLocationIds, page, pageSize },
    });
    const message = error instanceof Error ? error.message : 'Failed to load sales summary';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}