import { imsQuery } from '@/services/IMSMySQLService';

import type { OrderKind } from './orderLifecyclePolicy';

export type OrderAmendmentHistoryEntry = {
  id: number;
  previousStatus: string;
  resultingStatus: string;
  actorName: string | null;
  lineChangeCount: number;
  createdAt: string;
  completedAt: string | null;
};

function parseHeader(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function getOrderAmendmentHistory(
  businessId: string,
  orderKind: OrderKind,
  orderId: number,
): Promise<OrderAmendmentHistoryEntry[]> {
  const rows = await imsQuery<any>(
    `SELECT operation.id, operation.order_status, operation.actor_name,
            operation.after_header_json, operation.created_at, operation.completed_at,
            COUNT(line.id) AS line_change_count
       FROM ims_order_amendment_operations operation
       LEFT JOIN ims_order_amendment_lines line
         ON line.business_id = operation.business_id AND line.amendment_id = operation.id
      WHERE operation.business_id = ? AND operation.order_kind = ?
        AND operation.order_id = ? AND operation.state = 'complete'
      GROUP BY operation.id, operation.order_status, operation.actor_name,
               operation.after_header_json, operation.created_at, operation.completed_at
      ORDER BY operation.id DESC
      LIMIT 25`,
    [businessId, orderKind, orderId],
  );

  return rows.map(row => {
    const afterHeader = parseHeader(row.after_header_json);
    return {
      id: Number(row.id),
      previousStatus: String(row.order_status ?? ''),
      resultingStatus: String(afterHeader?.status ?? row.order_status ?? ''),
      actorName: row.actor_name == null ? null : String(row.actor_name),
      lineChangeCount: Number(row.line_change_count ?? 0),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ''),
      completedAt: row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at == null ? null : String(row.completed_at),
    };
  });
}