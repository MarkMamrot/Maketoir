import { imsQuery } from '@/services/IMSMySQLService';

import type { OrderKind } from './orderLifecyclePolicy';

export type OrderAmendmentHistoryEntry = {
  id: number;
  entryKey?: string;
  activityType?: 'amendment' | 'receive' | 'fulfilment' | 'resolution' | 'receipt_undo' | 'credit' | 'replacement';
  title?: string;
  summary?: string;
  state?: string;
  details?: string[];
  documentType?: 'purchase_order' | 'sales_order' | 'credit_note' | 'supplier_credit_note';
  documentId?: number;
  documentNumber?: string;
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

function allocationFulfilmentDetails(response: Record<string, unknown> | null): {
  consumed: number;
  released: number;
  details: string[];
} {
  const allocations = parseArray(response?.allocationFulfilments)
    .filter(item => item && typeof item === 'object') as Record<string, unknown>[];
  let consumed = 0;
  let released = 0;
  const details = allocations.map(item => {
    const lineConsumed = Math.max(0, Number(item.consumedQuantity ?? 0) || 0);
    const lineReleased = Math.max(0, Number(item.releasedQuantity ?? 0) || 0);
    consumed += lineConsumed;
    released += lineReleased;
    const actions = [
      lineConsumed > 0 ? `consumed ${lineConsumed} received protected unit${lineConsumed === 1 ? '' : 's'}` : '',
      lineReleased > 0 ? `released ${lineReleased} future protected unit${lineReleased === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    const allocationIds = [
      ...parseArray(item.fulfilledAllocationIds),
      ...parseArray(item.releasedAllocationIds),
    ].map(Number).filter(id => Number.isInteger(id) && id > 0);
    return `Line #${String(item.soItemId ?? '—')}: ${actions.join('; ')}${allocationIds.length > 0 ? ` (allocations ${allocationIds.map(id => `#${id}`).join(', ')})` : ''}`;
  }).filter(detail => !detail.endsWith(': '));
  return { consumed, released, details };
}

const HIDDEN_HEADER_FIELDS = new Set(['id', 'business_id', 'created_at', 'updated_at']);

function changedHeaderFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  if (!after) return [];
  return Object.keys(after)
    .filter(field => !HIDDEN_HEADER_FIELDS.has(field) && field !== 'status')
    .filter(field => !before || JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .sort();
}

export async function getOrderActivityHistory(
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
    const isReceiptUndo = orderKind === 'purchase_order' && afterHeader?.correction === 'undo_mistaken_receipt';
    return {
      id: Number(row.id),
      entryKey: `amendment:${row.id}`,
      activityType: isReceiptUndo ? 'receipt_undo' : 'amendment',
      ...(isReceiptUndo ? {
        title: 'Mistaken receipt undone',
        summary: 'Received stock was reversed and the purchase order was cancelled',
        state: String(afterHeader?.status ?? 'cancelled'),
      } : {}),
      previousStatus: String(row.order_status ?? ''),
      resultingStatus: String(afterHeader?.status ?? row.order_status ?? ''),
      actorName: row.actor_name == null ? null : String(row.actor_name),
      lineChangeCount: Number(row.line_change_count ?? 0),
      changedFields: isReceiptUndo ? [] : changedHeaderFields(beforeHeader, afterHeader),
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
      const allocationActivity = allocationFulfilmentDetails(response);
      title = response?.status === 'fulfilled' ? 'Fulfilment completed' : 'Shipment recorded';
      summary = `${shipments.length} line${shipments.length === 1 ? '' : 's'} submitted`;
      details = shipments.map(item => `Line #${String(item.itemId ?? '—')}: shipped ${Number(item.quantity ?? 0)}`);
      if (allocationActivity.consumed > 0) summary += `; ${allocationActivity.consumed} received protected unit${allocationActivity.consumed === 1 ? '' : 's'} consumed`;
      if (allocationActivity.released > 0) summary += `; ${allocationActivity.released} future protected unit${allocationActivity.released === 1 ? '' : 's'} released`;
      details.push(...allocationActivity.details);
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

  const linkedRows = (orderKind === 'purchase_order'
    ? await imsQuery<any>(
      `(SELECT scn.id, 'credit' AS activity_type, 'supplier_credit_note' AS document_type,
               scn.scn_number AS document_number, scn.status AS state, scn.total_amount,
               scn.created_at, scn.completed_at
          FROM ims_supplier_credit_notes scn
         WHERE scn.business_id = ? AND scn.po_id = ?)
       UNION ALL
       (SELECT child.id, 'replacement_child' AS activity_type, 'purchase_order' AS document_type,
               child.po_number AS document_number, child.status AS state, child.total_amount,
               child.created_at, NULL AS completed_at
          FROM ims_purchase_orders child
         WHERE child.business_id = ? AND child.replacement_of_po_id = ?)
       UNION ALL
       (SELECT source.id, 'replacement_source' AS activity_type, 'purchase_order' AS document_type,
               source.po_number AS document_number, source.status AS state, source.total_amount,
               current.created_at, NULL AS completed_at
          FROM ims_purchase_orders current
          JOIN ims_purchase_orders source
            ON source.id = current.replacement_of_po_id AND source.business_id = current.business_id
         WHERE current.business_id = ? AND current.id = ?)
       ORDER BY created_at DESC LIMIT 25`,
      [businessId, orderId, businessId, orderId, businessId, orderId],
    )
    : await imsQuery<any>(
      `(SELECT cn.id, 'credit' AS activity_type, 'credit_note' AS document_type,
               cn.cn_number AS document_number, cn.status AS state, cn.total_amount,
               cn.created_at, cn.completed_at
          FROM ims_credit_notes cn
         WHERE cn.business_id = ? AND cn.so_id = ?)
       UNION ALL
       (SELECT child.id, 'replacement_child' AS activity_type, 'sales_order' AS document_type,
               child.so_number AS document_number, child.status AS state, child.total_amount,
               child.created_at, NULL AS completed_at
          FROM ims_sales_orders child
         WHERE child.business_id = ? AND child.replacement_of_so_id = ?)
       UNION ALL
       (SELECT source.id, 'replacement_source' AS activity_type, 'sales_order' AS document_type,
               source.so_number AS document_number, source.status AS state, source.total_amount,
               current.created_at, NULL AS completed_at
          FROM ims_sales_orders current
          JOIN ims_sales_orders source
            ON source.id = current.replacement_of_so_id AND source.business_id = current.business_id
         WHERE current.business_id = ? AND current.id = ?)
       ORDER BY created_at DESC LIMIT 25`,
      [businessId, orderId, businessId, orderId, businessId, orderId],
    )) ?? [];

  const linkedEntries: OrderAmendmentHistoryEntry[] = linkedRows.map(row => {
    const isCredit = row.activity_type === 'credit';
    const isSource = row.activity_type === 'replacement_source';
    const documentNumber = String(row.document_number ?? `#${row.id}`);
    return {
      id: Number(row.id),
      entryKey: `${String(row.activity_type)}:${String(row.document_type)}:${row.id}`,
      activityType: isCredit ? 'credit' : 'replacement',
      title: isCredit
        ? orderKind === 'purchase_order' ? 'Supplier Return / Credit linked' : 'Return / Credit linked'
        : isSource ? 'Created from source order' : 'Replacement Draft created',
      summary: isCredit
        ? `${documentNumber} · ${Number(row.total_amount ?? 0).toFixed(2)}`
        : isSource ? `Source ${documentNumber}` : `Child ${documentNumber}`,
      state: String(row.state ?? ''),
      details: [],
      documentType: String(row.document_type) as OrderAmendmentHistoryEntry['documentType'],
      documentId: Number(row.id),
      documentNumber,
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

  return [...amendmentEntries, ...activityEntries, ...linkedEntries]
    .sort((left, right) => Date.parse(right.completedAt ?? right.createdAt) - Date.parse(left.completedAt ?? left.createdAt))
    .slice(0, 25);
}

  export const getOrderAmendmentHistory = getOrderActivityHistory;