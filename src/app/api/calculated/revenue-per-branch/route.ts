import { NextResponse } from 'next/server';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { SalesRepository } from '@/lib/db/SalesRepository';
import { getInventorySource, getSales } from '@/lib/dataProvider';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  try {
    const source = await getInventorySource(databaseId);
    const oneYearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
    const now = Date.now();
    const cut90 = now - 90 * 86400_000, cut180 = now - 180 * 86400_000;

    const rev: Record<string, { branch: string; revenue90: number; revenue180: number; revenue365: number }> = {};

    if (source === 'solvantis') {
      const sales = await getSales(databaseId, 'solvantis', { from: oneYearAgo });
      for (const row of sales) {
        const dt = new Date(row.date).getTime();
        if (isNaN(dt)) continue;
        const branch = row.location_name ?? 'Unknown';
        const total = Number(row.line_total);
        if (!rev[branch]) rev[branch] = { branch, revenue90: 0, revenue180: 0, revenue365: 0 };
        rev[branch].revenue365 += total;
        if (dt >= cut180) rev[branch].revenue180 += total;
        if (dt >= cut90)  rev[branch].revenue90  += total;
      }
    } else {
      const inventorySystemId = await resolveInventorySystemId(databaseId);
      const sales = await SalesRepository.query(inventorySystemId, { from: oneYearAgo });
      for (const row of sales) {
        const dt = new Date(row.invoice_date).getTime();
        if (isNaN(dt)) continue;
        const branch = row.branch_id ?? 'Unknown';
        const total = Number(row.line_total);
        if (!rev[branch]) rev[branch] = { branch, revenue90: 0, revenue180: 0, revenue365: 0 };
        rev[branch].revenue365 += total;
        if (dt >= cut180) rev[branch].revenue180 += total;
        if (dt >= cut90)  rev[branch].revenue90  += total;
      }
    }

    const branches = Object.values(rev).sort((a, b) => b.revenue365 - a.revenue365);
    return NextResponse.json({ success: true, branches });
  } catch (err: any) {
    console.error('[revenue-per-branch GET]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
