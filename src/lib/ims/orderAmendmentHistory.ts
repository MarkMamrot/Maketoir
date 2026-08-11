import { imsQuery } from '@/services/IMSMySQLService';

import type { OrderKind } from './orderLifecyclePolicy';

export type OrderAmendmentHistoryEntry = {
  id: number;
  entryKey?: string;
  activityType?: 'amendment' | 'receive' | 'fulfilment' | 'resolution';
  title?: string;
  summary?: string;
  state?: string;
  details?: string[];
  previousStatus: string;
  resultingStatus: string;
  actorName: string | null;
  lineChangeCount: number;
  changedFields: string[];
  lines: Array<{
    id: number;
    changeType: 'added' | 'removed' | 'updated';
    variantId: string | null;
    previousQuantity: number | null;
    resultingQuantity: number | null;
  }>;
  createdAt: string;
  completedAt: string | null;
};

function parseObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? '');
}

const HIDDEN_HEADER_FIELDS = new Set(['id', 'business_id', 'created_at', 'updated_at']);

function changedHeaderFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  if (!after) return [];
  return Object.keys(after)
    .filter(field => !HIDDEN_HEADER_FIELDS.has(field) && field !== 'status')
    .filter(field => !before || JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .sort();
}

export async function getOrderAmendmentHistory(
  businessId: string,
  orderKind: OrderKind,
  orderId: number,
): Promise<OrderAmendmentHistoryEntry[]> {
  const rows = await imsQuery<any>(
    `SELECT operation.id, operation.order_status, operation.actor_name,
            operation.before_header_json, operation.after_header_json,
            operation.created_at, operation.completed_at, COUNT(line.id) AS line_change_count
       FROM ims_order_amendment_operations operation
       LEFT JOIN ims_order_amendment_lines line
         ON line.business_id = operation.business_id AND line.amendment_id = operation.id
      WHERE operation.business_id = ? AND operation.order_kind = ?
        AND operation.order_id = ? AND operation.state = 'complete'
      GROUP BY operation.id, operation.order_status, operation.actor_name, operation.before_header_json,
               operation.after_header_json, operation.created_at, operation.completed_at
      ORDER BY operation.id DESC
      LIMIT 25`,
    [businessId, orderKind, orderId],
  );

  const operationIds = rows.map(row => Number(row.id)).filter(Number.isFinite);
  const lineRows = operationIds.length === 0 ? [] : await imsQuery<any>(
    `SELECT id, amendment_id, source_line_id, result_line_id, before_line_json, after_line_json
       FROM ims_order_amendment_lines
      WHERE business_id = ? AND amendment_id IN (${operationIds.map(() => '?').join(',')})
      ORDER BY amendment_id DESC, id ASC`,
    [businessId, ...operationIds],
  );
  const linesByOperation = new Map<number, OrderAmendmentHistoryEntry['lines']>();
  for (const row of lineRows) {
    const beforeLine = parseObject(row.before_line_json);
    const afterLine = parseObject(row.after_line_json);
    const operationLines = linesByOperation.get(Number(row.amendment_id)) ?? [];
    operationLines.push({
      id: Number(row.id),
      changeType: row.source_line_id == null ? 'added' : row.result_line_id == null ? 'removed' : 'updated',
      variantId: afterLine?.variant_id == null
        ? beforeLine?.variant_id == null ? null : String(beforeLine.variant_id)
        : String(afterLine.variant_id),
      previousQuantity: beforeLine?.qty_ordered == null ? null : Number(beforeLine.qty_ordered),
      resultingQuantity: afterLine?.qty_ordered == null ? null : Number(afterLine.qty_ordered),
    });
    linesByOperation.set(Number(row.amendment_id), operationLines);
  }

  const amendmentEntries: OrderAmendmentHistoryEntry[] = rows.map(row => {
    const beforeHeader = parseObject(row.before_header_json);
    const afterHeader = parseObject(row.after_header_json);
    return {
      id: Number(row.id),
      entryKey: `amendment:${row.id}`,
      activityType: 'amendment',
      previousStatus: String(row.order_status ?? ''),
      resultingStatus: String(afterHeader?.status ?? row.order_status ?? ''),
      actorName: row.actor_name == null ? null : String(row.actor_name),
      lineChangeCount: Number(row.line_change_count ?? 0),
      changedFields: changedHeaderFields(beforeHeader, afterHeader),
      lines: linesByOperation.get(Number(row.id)) ?? [],
      createdAt: toIso(row.created_at),
      completedAt: row.completed_at == null ? null : toIso(row.completed_at),
    };
  });

  const activityRows = orderKind === 'purchase_order'
    ? await imsQuery<any>(
      `(SELECT id, 'receive' AS activity_type, status AS state, NULL AS outcome, NULL AS settlement,
               request_json, response_json, created_at, completed_at
          FROM ims_po_receive_operations
         WHERE business_id = ? AND po_id = ?)
       UNION ALL
       (SELECT id, 'resolution' AS activity_type, state, outcome, settlement,
               NULL AS request_json, response_json, created_at, completed_at
          FROM ims_po_shortfall_resolutions
         WHERE business_id = ? AND source_po_id = ?)
       ORDER BY created_at DESC LIMIT 25`,
      [businessId, orderId, businessId, orderId],
    )
    : await imsQuery<any>(
      `(SELECT id, 'fulfilment' AS activity_type, status AS state, NULL AS outcome, NULL AS settlement,
               request_json, response_json, created_at, completed_at
          FROM ims_so_fulfilment_operations
         WHERE business_id = ? AND so_id = ?)
       UNION ALL
       (SELECT id, 'resolution' AS activity_type, state, outcome, settlement,
               NULL AS request_json, response_json, created_at, completed_at
          FROM ims_so_shortfall_resolutions
         WHERE business_id = ? AND source_so_id = ?)
       ORDER BY created_at DESC LIMIT 25`,
      [businessId, orderId, businessId, orderId],
    );

  const activityEntries: OrderAmendmentHistoryEntry[] = activityRows.map(row => {
    const request = parseObject(row.request_json);
    const response = parseObject(row.response_json);
    const activityType = String(row.activity_type) as 'receive' | 'fulfilment' | 'resolution';
    let title = 'Order activity';
    let summary = '';
    let details: string[] = [];

    if (activityType === 'receive') {
      const items = parseArray(request?.received_items).filter(item => item && typeof item === 'object') as Record<string, unknown>[];
      title = response?.newStatus === 'complete' ? 'Receipt completed' : 'Receive progress saved';
      summary = `${items.length} line${items.length === 1 ? '' : 's'} submitted`;
      if (response?.backorderPoNumber) summary += `; backorder ${String(response.backorderPoNumber)} created`;
      details = items.map(item => `Variant ${String(item.variant_id ?? '—')}: received ${Number(item.qty_received ?? 0)}`);
    } else if (activityType === 'fulfilment') {
      const shipments = parseArray(request?.shipmentQuantities).filter(item => item && typeof item === 'object') as Record<string, unknown>[];
      title = response?.status === 'fulfilled' ? 'Fulfilment completed' : 'Shipment recorded';
      summary = `${shipments.length} line${shipments.length === 1 ? '' : 's'} submitted`;
      details = shipments.map(item => `Line #${String(item.itemId ?? '—')}: shipped ${Number(item.quantity ?? 0)}`);
    } else {
      const outcomeLabels: Record<string, string> = {
        leave_partial: 'Remainder left open',
        cancel_remainder: 'Outstanding quantity cancelled',
        create_backorder: 'Outstanding quantity moved to backorder',
      };
      title = outcomeLabels[String(row.outcome)] ?? 'Outstanding quantity resolved';
      summary = row.settlement && row.settlement !== 'none'
        ? `Settlement: ${String(row.settlement).replaceAll('_', ' ')}`
        : 'No financial settlement required';
      const childId = response?.childOrderId ?? response?.childPoId ?? response?.childSoId;
      if (childId != null) details.push(`Created child order #${String(childId)}`);
    }

    return {
      id: Number(row.id),
      entryKey: `${activityType}:${row.id}`,
      activityType,
      title,
      summary,
      state: String(row.state ?? ''),
      details,
      previousStatus: '',
      resultingStatus: '',
      actorName: null,
      lineChangeCount: 0,
      changedFields: [],
      lines: [],
      createdAt: toIso(row.created_at),
      completedAt: row.completed_at == null ? null : toIso(row.completed_at),
    };
  });

  return [...amendmentEntries, ...activityEntries]
    .sort((left, right) => Date.parse(right.completedAt ?? right.createdAt) - Date.parse(left.completedAt ?? left.createdAt))
    .slice(0, 25);
}