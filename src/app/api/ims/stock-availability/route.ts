import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { loadStockAvailabilityRows } from '@/lib/ims/stockAvailabilityQuery';
import { summarizeStockAvailabilityRow, type StockAvailabilityIssue } from '@/lib/ims/stockAvailabilityWorkbench';
import { buildDemandReadiness } from '@/lib/ims/stockAllocation/domain';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

const ISSUE_KEYS: StockAvailabilityIssue[] = ['at_risk', 'overdue', 'unsourced', 'ready', 'incoming', 'held'];

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId);

  try {
    const rows = await loadStockAvailabilityRows(businessId);
    const readiness = buildDemandReadiness(rows.map(row => ({
      soId: Number(row.so_id),
      soItemId: Number(row.so_item_id),
      variantId: String(row.variant_id),
      locationId: Number(row.location_id),
      requiredDate: row.expected_date == null ? null : String(row.expected_date).slice(0, 10),
      createdAt: new Date(row.created_at).toISOString(),
      outstandingQuantity: Number(row.qty_ordered ?? 0) - Number(row.qty_fulfilled ?? 0),
      activeAllocatedQuantity: Number(row.qty_allocated ?? 0),
      receivedAssignedQuantity: Number(row.qty_received_assigned ?? 0),
      allocationFulfilledQuantity: Number(row.allocation_qty_fulfilled ?? 0),
    })), rows.map(row => ({
      variantId: String(row.variant_id),
      locationId: Number(row.location_id),
      quantityOnHand: Number(row.qty_on_hand ?? 0),
    })));
    const readinessByItemId = new Map(readiness.map(row => [row.soItemId, row]));

    const data = rows.map(row => {
      const summary = summarizeStockAvailabilityRow(row);
      const lineReadiness = readinessByItemId.get(Number(row.so_item_id));
      const issues = summary.issues.filter(issue => issue !== 'ready');
      if (Number(lineReadiness?.readyNowQuantity ?? 0) > 0) {
        const incomingIndex = issues.indexOf('incoming');
        issues.splice(incomingIndex < 0 ? issues.length : incomingIndex, 0, 'ready');
      }
      return {
        ...row,
        qty_on_hand: Number(row.qty_on_hand),
        qty_committed: Number(row.qty_committed),
        qty_incoming: Number(row.qty_incoming),
        allocation_count: Number(row.allocation_count ?? 0),
        ...summary,
        ...lineReadiness,
        issues,
      };
    });
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