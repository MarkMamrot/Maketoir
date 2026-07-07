import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { YearlyRevenueRepository } from '@/lib/db/CalcReportsRepository';
import { getInventorySource } from '@/lib/dataProvider';
import { imsQuery } from '@/services/IMSMySQLService';

function getYearPeriods(): string[] {
  const y = new Date().getFullYear();
  return [String(y - 1), String(y - 2), String(y - 3)];
}

// Revenue by calendar year from the IMS database — ALL sales channels, GST exc.
// Buckets: online SOs → 'Online'; b2b SOs & POS → physical location name.
// Includes historical migrated orders. GST-exc: SOs use subtotal, POS uses total-tax.
async function computeYearlyFromIMS(bizId: string): Promise<Record<string, Record<string, string>>> {
  const [soRows, posRows] = await Promise.all([
    imsQuery<any>(
      `SELECT CASE WHEN so.so_type = 'online' THEN 'Online' ELSE COALESCE(l.name, 'Unknown') END AS branch,
              YEAR(so.order_date) AS yr,
              SUM(so.subtotal)    AS revenue
       FROM ims_sales_orders so
       LEFT JOIN ims_locations l ON l.id = so.location_id
       WHERE so.business_id = ? AND so.status = 'fulfilled'
       GROUP BY branch, yr`,
      [bizId],
    ),
    imsQuery<any>(
      `SELECT COALESCE(l.name, 'Unknown')   AS branch,
              YEAR(ps.completed_at)          AS yr,
              SUM(ps.total - ps.tax_total)   AS revenue
       FROM pos_sales ps
       JOIN ims_locations l ON l.id = ps.location_id AND l.business_id = ?
       WHERE ps.status = 'completed' AND ps.sale_type = 'sale'
       GROUP BY branch, yr`,
      [bizId],
    ),
  ]);
  const data: Record<string, Record<string, number>> = {};
  for (const r of [...soRows, ...posRows]) {
    const branch = String(r.branch ?? 'Unknown');
    const yr = String(r.yr ?? '');
    if (!yr) continue;
    if (!data[branch]) data[branch] = {};
    data[branch][yr] = (data[branch][yr] ?? 0) + Number(r.revenue ?? 0);
  }
  const out: Record<string, Record<string, string>> = {};
  for (const [branch, years] of Object.entries(data)) {
    out[branch] = {};
    for (const [yr, val] of Object.entries(years)) out[branch][yr] = val.toFixed(2);
  }
  return out;
}

export async function GET(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId required.' }, { status: 400 });

  const _cu = JSON.parse(session.value);
  if (databaseId !== _cu.businessId) return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });

  try {
    const source = await getInventorySource(databaseId);
    if (source === 'solvantis') {
      // Compute live from the IMS database (all channels incl. historical + POS).
      const data = await computeYearlyFromIMS(databaseId);
      return NextResponse.json({ success: true, data, computed: 'ims' });
    }

    const inventorySystemId = await resolveInventorySystemId(databaseId);
    const rows = await YearlyRevenueRepository.list(inventorySystemId);

    const data: Record<string, Record<string, string>> = {};
    for (const row of rows) {
      const branch = row.extra_json?.branch ?? 'Total';
      if (!data[branch]) data[branch] = {};
      data[branch][String(row.year)] = String(row.revenue.toFixed(2));
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('[yearly-revenue GET]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { databaseId, data } = await req.json();
  const _cu = JSON.parse(session.value);
  if (!databaseId || typeof data !== 'object' || databaseId !== _cu.businessId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  try {
    const inventorySystemId = await resolveInventorySystemId(databaseId);
    const yearPeriods = getYearPeriods();

    const rows: { year: number; revenue: number; extra_json: { branch: string } }[] = [];
    for (const [branch, periods] of Object.entries(data as Record<string, Record<string, string>>)) {
      for (const year of yearPeriods) {
        const val = parseFloat((periods as any)[year] ?? '0');
        if (!isNaN(val)) {
          rows.push({ year: parseInt(year, 10), revenue: val, extra_json: { branch } });
        }
      }
    }

    await YearlyRevenueRepository.bulkReplace(inventorySystemId, rows);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[yearly-revenue POST]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
