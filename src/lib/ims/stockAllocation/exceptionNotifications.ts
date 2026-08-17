import { createNotification } from '@/lib/ims/createNotification';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export type StockAllocationExceptionReason = 'delayed' | 'cancelled' | 'reduced' | 'received_short';

export type StockAllocationExceptionGroup = {
  soId: number;
  soNumber: string;
  affectedQuantity: number;
  allocationCount: number;
};

type AllocationExceptionRow = {
  so_id: number | string;
  so_number: string;
  affected_quantity: number | string;
  allocation_count: number | string;
};

type QueryConnection = {
  execute: (sql: string, params?: unknown[]) => Promise<any>;
};

const COPY: Record<StockAllocationExceptionReason, { title: string; action: string }> = {
  delayed: { title: 'Protected purchase order delayed', action: 'has been delayed' },
  cancelled: { title: 'Protected purchase order cancelled', action: 'has been cancelled' },
  reduced: { title: 'Protected purchase order reduced', action: 'has been reduced' },
  received_short: { title: 'Protected purchase order received short', action: 'was completed short' },
};

export function normalizeExpectedDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const normalized = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

export function isExpectedDateDelay(previous: unknown, next: unknown): boolean {
  const previousDate = normalizeExpectedDate(previous);
  const nextDate = normalizeExpectedDate(next);
  return previousDate != null && (nextDate == null || nextDate > previousDate);
}

export function normalizeStockAllocationExceptionGroups(rows: AllocationExceptionRow[]): StockAllocationExceptionGroup[] {
  return rows
    .map(row => ({
      soId: Number(row.so_id),
      soNumber: String(row.so_number),
      affectedQuantity: Number(Number(row.affected_quantity).toFixed(4)),
      allocationCount: Number(row.allocation_count),
    }))
    .filter(group => group.soId > 0 && group.affectedQuantity > 0 && group.allocationCount > 0);
}

export async function loadStockAllocationExceptionGroups(
  conn: QueryConnection,
  input: { businessId: string; poId: number },
): Promise<StockAllocationExceptionGroup[]> {
  const [rows] = await conn.execute(
    `SELECT a.so_id, so.so_number,
            SUM(GREATEST(0, a.qty_allocated - a.qty_received_assigned)) AS affected_quantity,
            COUNT(*) AS allocation_count
       FROM ims_stock_allocations a
       JOIN ims_sales_orders so ON so.id = a.so_id
        AND so.business_id COLLATE utf8mb4_general_ci = a.business_id COLLATE utf8mb4_general_ci
      WHERE a.business_id = ? AND a.po_id = ? AND a.state = 'active'
      GROUP BY a.so_id, so.so_number
      ORDER BY so.so_number, a.so_id`,
    [input.businessId, input.poId],
  );
  return normalizeStockAllocationExceptionGroups(rows as AllocationExceptionRow[]);
}

export async function notifyStockAllocationExceptions(input: {
  businessId: string;
  poId: number;
  poNumber?: string | null;
  reason: StockAllocationExceptionReason;
  groups: StockAllocationExceptionGroup[];
}): Promise<void> {
  const copy = COPY[input.reason];
  const poLabel = input.poNumber?.trim() || `PO ${input.poId}`;

  await Promise.all(input.groups.map(async group => {
    try {
      const quantity = group.affectedQuantity;
      await createNotification(
        input.businessId,
        'stock_allocation',
        copy.title,
        `${poLabel} ${copy.action}; ${quantity} protected ${quantity === 1 ? 'unit requires' : 'units require'} review for ${group.soNumber}.`,
        {
          action: 'open_sales_order',
          so_id: group.soId,
          po_id: input.poId,
          reason: input.reason,
          affected_quantity: quantity,
          allocation_count: group.allocationCount,
        },
        'warning',
      );
    } catch (error) {
      await reportRuntimeIssue({
        businessId: input.businessId,
        source: 'ims_stock_allocations',
        operation: 'notify_supply_exception',
        title: 'Protected supply exception notification failed',
        error,
        context: { poId: input.poId, soId: group.soId, reason: input.reason },
        reference: { type: 'sales_order', id: group.soId },
      }).catch(() => {});
    }
  }));
}