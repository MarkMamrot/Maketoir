import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { loadStockAvailabilityRows } from '@/lib/ims/stockAvailabilityQuery';
import { summarizeStockAvailabilityRow, type StockAvailabilityIssue } from '@/lib/ims/stockAvailabilityWorkbench';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

const ISSUE_KEYS: StockAvailabilityIssue[] = ['at_risk', 'overdue', 'unsourced', 'ready', 'incoming', 'held'];

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId);

  try {
    const rows = await loadStockAvailabilityRows(businessId);

    const data = rows.map(row => ({
      ...row,
      qty_on_hand: Number(row.qty_on_hand),
      qty_committed: Number(row.qty_committed),
      qty_incoming: Number(row.qty_incoming),
      allocation_count: Number(row.allocation_count ?? 0),
      ...summarizeStockAvailabilityRow(row),
    }));
    const counts = Object.fromEntries(ISSUE_KEYS.map(issue => [issue, data.filter(row => row.issues.includes(issue)).length]));

    return NextResponse.json({ success: true, data, summary: { total: data.length, counts } });
  } catch (error: any) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims_stock_availability',
      operation: 'load_workbench',
      title: 'Stock availability workbench could not be loaded',
      error,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message || 'Failed to load stock availability.' }, { status: 500 });
  }
}