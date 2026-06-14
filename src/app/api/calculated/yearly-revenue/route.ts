import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { YearlyRevenueRepository } from '@/lib/db/CalcReportsRepository';
import { getInventorySource } from '@/lib/dataProvider';

function getYearPeriods(): string[] {
  const y = new Date().getFullYear();
  return [String(y - 1), String(y - 2), String(y - 3)];
}

export async function GET(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId required.' }, { status: 400 });

  try {
    const source = await getInventorySource(databaseId);
    if (source === 'solvantis') {
      return NextResponse.json({ success: true, data: {}, note: 'Yearly revenue reports are not available for Solvantis IMS.' });
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
  if (!databaseId || typeof data !== 'object' || databaseId !== _cu.userSpreadsheetId) {
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
