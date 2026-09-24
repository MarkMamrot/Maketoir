import { imsQuery } from '@/services/IMSMySQLService';
import {
  compareAuditFindingsNewestFirst,
  fingerprintAuditEvidence,
  isAuditOverdue,
  resolveAuditDueDate,
  type AuditDueDateRule,
  type AuditFinding,
} from './domain';

export interface DocumentAuditRow {
  source_type: 'purchase_order' | 'sales_order' | 'customer_credit_note' | 'supplier_credit_note' | 'branch_transfer' | 'stocktake';
  source_id: string | number;
  source_reference: string;
  status: string;
  fallback_date: string;
  explicit_due_date: string | null;
  due_rule: AuditDueDateRule;
  occurred_at: string;
  outstanding_quantity: number | string | null;
  value_at_risk: number | string | null;
}

export interface NegativeStockAuditRow {
  product_id: string;
  variant_id: string;
  sku: string;
  product_name: string;
  location_id: number;
  location_name: string;
  qty_on_hand: number | string;
  unit_cost: number | string | null;
  updated_at: string;
}

type Dependencies = { query: typeof imsQuery };
const defaultDependencies: Dependencies = { query: imsQuery };

const DOCUMENT_LABELS: Record<DocumentAuditRow['source_type'], string> = {
  purchase_order: 'Purchase order',
  sales_order: 'Sales order',
  customer_credit_note: 'Customer credit note',
  supplier_credit_note: 'Supplier credit note',
  branch_transfer: 'Branch transfer',
  stocktake: 'Stocktake',
};

const SOURCE_HASHES: Record<DocumentAuditRow['source_type'], string> = {
  purchase_order: 'purchase-orders',
  sales_order: 'sales-orders',
  customer_credit_note: 'credit-notes',
  supplier_credit_note: 'supplier-credit-notes',
  branch_transfer: 'branch-transfers',
  stocktake: 'stocktakes',
};

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

export function buildDocumentAuditFindings(rows: DocumentAuditRow[], asOfDate: string): AuditFinding[] {
  return rows.flatMap(row => {
    const dueDate = resolveAuditDueDate({
      explicitDate: row.explicit_due_date ? dateOnly(row.explicit_due_date) : null,
      fallbackDate: dateOnly(row.fallback_date),
      rule: row.due_rule,
    });
    if (!isAuditOverdue(dueDate, asOfDate)) return [];
    const isDraft = row.status === 'draft';
    const findingKind = isDraft ? 'stale_draft' : 'overdue';
    const outstandingQuantity = row.outstanding_quantity == null ? null : Number(row.outstanding_quantity);
    const valueAtRisk = row.value_at_risk == null ? null : Number(row.value_at_risk);
    const evidence = {
      status: row.status,
      dueDate: dueDate.date,
      outstandingQuantity,
      valueAtRisk,
    };
    const label = DOCUMENT_LABELS[row.source_type];
    return [{
      key: `${row.source_type}:${row.source_id}:${findingKind}`,
      fingerprint: fingerprintAuditEvidence(evidence),
      category: 'orders_returns' as const,
      severity: row.status === 'backordered' || row.status === 'partially_received' ? 'error' as const : 'warning' as const,
      coverage: 'checked' as const,
      title: `${label} ${isDraft ? 'is a stale draft' : 'is overdue'}`,
      summary: `${row.source_reference} has remained ${row.status.replaceAll('_', ' ')} past ${dueDate.date}.`,
      sourceType: row.source_type,
      sourceId: String(row.source_id),
      sourceReference: row.source_reference,
      sourceHref: `#${SOURCE_HASHES[row.source_type]}/${row.source_id}`,
      occurredAt: row.occurred_at,
      detectedAt: new Date().toISOString(),
      dueDate,
      expected: dueDate.date,
      actual: row.status.replaceAll('_', ' '),
      variance: outstandingQuantity,
      valueAtRisk,
      recommendedAction: isDraft
        ? `Confirm whether ${row.source_reference} should proceed or be cancelled.`
        : `Open ${row.source_reference} and complete, receive, fulfil, or resolve the outstanding work.`,
    }];
  });
}

export function buildNegativeStockAuditFindings(rows: NegativeStockAuditRow[]): AuditFinding[] {
  return rows.map(row => {
    const quantity = Number(row.qty_on_hand);
    const unitCost = Number(row.unit_cost ?? 0);
    const valueAtRisk = Math.abs(quantity * unitCost);
    return {
      key: `stock:${row.variant_id}:${row.location_id}:negative`,
      fingerprint: fingerprintAuditEvidence({ quantity, unitCost }),
      category: 'stock',
      severity: quantity <= -1 ? 'error' : 'warning',
      coverage: 'checked',
      title: 'Negative stock on hand',
      summary: `${row.sku || row.product_name} has ${quantity} on hand at ${row.location_name}.`,
      sourceType: 'stock_position',
      sourceId: `${row.variant_id}:${row.location_id}`,
      sourceReference: row.sku || row.product_name,
      sourceHref: `#products/${encodeURIComponent(row.product_id)}`,
      occurredAt: row.updated_at,
      detectedAt: new Date().toISOString(),
      dueDate: null,
      expected: 0,
      actual: quantity,
      variance: quantity,
      valueAtRisk,
      recommendedAction: 'Review recent movements, then receive, transfer, count, or correct the stock through its source workflow.',
    } satisfies AuditFinding;
  });
}

export async function loadOperationalAuditFindings(
  businessId: string,
  asOfDate: string,
  dependencies: Dependencies = defaultDependencies,
): Promise<AuditFinding[]> {
  const [documents, negativeStock] = await Promise.all([
    dependencies.query<DocumentAuditRow>(
      `SELECT 'purchase_order' AS source_type, po.id AS source_id, po.po_number AS source_reference,
              po.status, DATE_FORMAT(po.order_date, '%Y-%m-%d') AS fallback_date,
              DATE_FORMAT(po.expected_date, '%Y-%m-%d') AS explicit_due_date,
              IF(po.status = 'draft', 'purchase_order_draft', 'purchase_order_active') AS due_rule,
              DATE_FORMAT(po.updated_at, '%Y-%m-%dT%H:%i:%s.000Z') AS occurred_at,
              SUM(GREATEST(0, poi.qty_ordered - poi.qty_received)) AS outstanding_quantity,
              po.total_amount AS value_at_risk
         FROM ims_purchase_orders po
         LEFT JOIN ims_purchase_order_items poi ON poi.po_id = po.id AND poi.business_id = ?
        WHERE po.business_id = ? AND po.status IN ('draft','confirmed','partially_received','backordered') AND po.is_historical = 0
        GROUP BY po.id
       UNION ALL
       SELECT 'sales_order', so.id, so.so_number, so.status, DATE_FORMAT(so.order_date, '%Y-%m-%d'),
              DATE_FORMAT(so.expected_date, '%Y-%m-%d'),
              IF(so.status = 'draft', 'sales_order_draft', 'sales_order_active'),
              DATE_FORMAT(so.updated_at, '%Y-%m-%dT%H:%i:%s.000Z'),
              SUM(GREATEST(0, soi.qty_ordered - soi.qty_fulfilled)), so.total_amount
         FROM ims_sales_orders so
         LEFT JOIN ims_sales_order_items soi ON soi.so_id = so.id AND soi.business_id = ?
        WHERE so.business_id = ? AND so.status IN ('draft','confirmed','partially_fulfilled','backordered')
          AND so.is_historical = 0 AND so.is_staff_preview_test = 0
        GROUP BY so.id
       UNION ALL
       SELECT 'customer_credit_note', cn.id, cn.cn_number, cn.status, DATE_FORMAT(cn.cn_date, '%Y-%m-%d'), NULL,
              IF(cn.status = 'draft', 'customer_credit_note_draft', 'customer_credit_note_awaiting_product'),
              DATE_FORMAT(cn.updated_at, '%Y-%m-%dT%H:%i:%s.000Z'), NULL, cn.total_amount
         FROM ims_credit_notes cn
        WHERE cn.business_id = ? AND cn.status IN ('draft','awaiting_product')
       UNION ALL
       SELECT 'supplier_credit_note', scn.id, scn.scn_number, scn.status, DATE_FORMAT(scn.scn_date, '%Y-%m-%d'), NULL,
              'supplier_credit_note_draft', DATE_FORMAT(scn.updated_at, '%Y-%m-%dT%H:%i:%s.000Z'), NULL, scn.total_amount
         FROM ims_supplier_credit_notes scn
        WHERE scn.business_id = ? AND scn.status = 'draft'
       UNION ALL
       SELECT 'branch_transfer', bt.id, bt.transfer_number, bt.status, DATE_FORMAT(bt.transfer_date, '%Y-%m-%d'), NULL,
              IF(bt.status = 'draft', 'branch_transfer_draft', 'branch_transfer_active'),
              DATE_FORMAT(bt.updated_at, '%Y-%m-%dT%H:%i:%s.000Z'),
              SUM(GREATEST(0, bti.qty_sent - COALESCE(bti.qty_received, 0))), bt.total_value
         FROM ims_branch_transfers bt
         LEFT JOIN ims_branch_transfer_items bti ON bti.transfer_id = bt.id
        WHERE bt.business_id = ? AND bt.status IN ('draft','sent','partial')
        GROUP BY bt.id
       UNION ALL
       SELECT 'stocktake', st.id, st.reference, st.status, DATE_FORMAT(st.created_at, '%Y-%m-%d'), NULL,
              'stocktake_in_progress', DATE_FORMAT(st.updated_at, '%Y-%m-%dT%H:%i:%s.000Z'), NULL, NULL
         FROM ims_stocktakes st
        WHERE st.business_id = ? AND st.status = 'in_progress'`,
      [businessId, businessId, businessId, businessId, businessId, businessId, businessId, businessId],
    ),
    dependencies.query<NegativeStockAuditRow>(
      `SELECT p.product_id, s.variant_id, COALESCE(v.sku, '') AS sku, COALESCE(p.name, 'Unknown product') AS product_name,
              s.location_id, COALESCE(l.name, 'Unknown location') AS location_name,
              s.qty_on_hand, COALESCE(NULLIF(v.avg_cost, 0), v.cost_aud, s.avg_cost, 0) AS unit_cost,
              DATE_FORMAT(s.updated_at, '%Y-%m-%dT%H:%i:%s.000Z') AS updated_at
         FROM ims_stock s
         JOIN ims_product_variants v ON v.variant_id = s.variant_id
         JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = ?
         JOIN ims_locations l ON l.id = s.location_id AND l.business_id = ?
        WHERE s.business_id = ? AND s.qty_on_hand < 0 AND v.is_active = 1 AND p.is_active = 1 AND p.is_stock_item = 1
        ORDER BY s.updated_at DESC, s.id DESC`,
      [businessId, businessId, businessId],
    ),
  ]);

  return [
    ...buildDocumentAuditFindings(documents, asOfDate),
    ...buildNegativeStockAuditFindings(negativeStock),
  ].sort(compareAuditFindingsNewestFirst);
}

export interface CogsAuditRow {
  movement_id: number;
  source_type: 'pos_sale' | 'sales_order';
  source_id: number;
  source_reference: string;
  sku: string;
  product_name: string;
  occurred_at: string;
  qty_change: number | string;
  unit_cost: number | string | null;
}

export function buildCogsAuditFindings(rows: CogsAuditRow[], periodEnd: string): AuditFinding[] {
  const groups = new Map<string, CogsAuditRow[]>();
  for (const row of rows) {
    const key = `${row.source_type}:${row.source_id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([sourceKey, sourceRows]) => {
    const first = sourceRows[0];
    const missingCount = sourceRows.filter(row => row.unit_cost == null).length;
    const zeroCount = sourceRows.filter(row => row.unit_cost != null && Number(row.unit_cost) === 0).length;
    const negativeCount = sourceRows.filter(row => row.unit_cost != null && -Number(row.qty_change) * Number(row.unit_cost) < 0).length;
    const affectedQuantity = sourceRows.reduce((sum, row) => sum + Math.abs(Number(row.qty_change)), 0);
    const attachedValue = sourceRows.reduce((sum, row) => sum + Math.max(0, -Number(row.qty_change) * Number(row.unit_cost ?? 0)), 0);
    const evidence = { movementIds: sourceRows.map(row => Number(row.movement_id)).sort((a, b) => a - b), missingCount, zeroCount, negativeCount };
    const problem = negativeCount > 0 ? 'negative' : missingCount > 0 ? 'missing' : 'zero';
    const products = [...new Map(sourceRows.map(row => [
      `${row.sku}:${row.product_name}`,
      row.sku ? `${row.product_name} (${row.sku})` : row.product_name,
    ])).values()];
    return {
      key: `cogs:${sourceKey}:${problem}`,
      fingerprint: fingerprintAuditEvidence(evidence),
      category: 'sales_cogs',
      severity: negativeCount > 0 || missingCount > 0 ? 'critical' : 'error',
      coverage: 'checked',
      title: `${negativeCount > 0 ? 'Negative' : missingCount > 0 ? 'Missing' : 'Zero'} COGS on sale`,
      summary: `${first.source_reference} has incomplete or invalid cost for ${products.join(', ')} in the month ending ${periodEnd}.`,
      sourceType: first.source_type,
      sourceId: String(first.source_id),
      sourceReference: first.source_reference,
      sourceHref: first.source_type === 'pos_sale' ? `#pos-sales/${first.source_id}` : `#sales-orders/${first.source_id}`,
      occurredAt: sourceRows.map(row => row.occurred_at).sort().at(-1)!,
      detectedAt: new Date().toISOString(),
      dueDate: null,
      expected: 'Positive recorded COGS',
      actual: `${missingCount} missing, ${zeroCount} zero, ${negativeCount} negative`,
      variance: affectedQuantity,
      valueAtRisk: attachedValue,
      recommendedAction: 'Review the sale movements and their receipt or opening cost source before relying on gross profit or posting COGS.',
    } satisfies AuditFinding;
  });
}

export async function loadCogsAuditFindings(
  businessId: string,
  period: { startDate: string; endDateExclusive: string; periodEnd: string },
  dependencies: Dependencies = defaultDependencies,
): Promise<AuditFinding[]> {
  const rows = await dependencies.query<CogsAuditRow>(
    `SELECT sm.id AS movement_id,
            IF(sm.movement_type = 'pos_sale', 'pos_sale', 'sales_order') AS source_type,
            sm.reference_id AS source_id,
            CASE WHEN sm.movement_type = 'pos_sale'
                 THEN COALESCE(NULLIF(ps.local_id, ''), CONCAT('POS #', ps.id))
                 ELSE COALESCE(so.so_number, CONCAT('SO #', sm.reference_id)) END AS source_reference,
              COALESCE(v.sku, '') AS sku, p.name AS product_name,
            DATE_FORMAT(sm.created_at, '%Y-%m-%dT%H:%i:%s.000Z') AS occurred_at,
            sm.qty_change, sm.unit_cost
       FROM ims_stock_movements sm
       JOIN ims_product_variants v ON v.variant_id = sm.variant_id
            JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = ? AND p.is_stock_item = 1
       LEFT JOIN pos_sales ps ON sm.movement_type = 'pos_sale' AND sm.reference_type = 'pos_sale'
        AND ps.id = sm.reference_id AND ps.business_id = ?
       LEFT JOIN ims_sales_orders so ON sm.movement_type = 'so_fulfilled' AND sm.reference_type = 'sales_order'
        AND so.id = sm.reference_id AND so.business_id = ?
      WHERE sm.business_id = ? AND sm.movement_type IN ('pos_sale','so_fulfilled')
        AND sm.created_at >= ? AND sm.created_at < ?
        AND ((sm.movement_type = 'pos_sale' AND ps.id IS NOT NULL AND ps.status = 'completed' AND ps.sale_type = 'sale' AND ps.is_historical = 0)
          OR (sm.movement_type = 'so_fulfilled' AND so.id IS NOT NULL AND so.is_historical = 0 AND so.cin7_order_id IS NULL))
        AND (sm.unit_cost IS NULL OR sm.unit_cost <= 0 OR -sm.qty_change * sm.unit_cost <= 0)
        AND NOT (sm.unit_cost <= 0 AND sm.cost_method_snapshot = 'fifo'
          AND EXISTS (
            SELECT 1 FROM ims_fifo_cost_allocations allocation
            JOIN ims_fifo_cost_layers layer ON layer.id = allocation.layer_id AND BINARY layer.business_id = BINARY allocation.business_id
            WHERE BINARY allocation.business_id = BINARY sm.business_id AND allocation.stock_movement_id = sm.id
              AND layer.zero_cost_reason IS NOT NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM ims_fifo_cost_allocations allocation
            JOIN ims_fifo_cost_layers layer ON layer.id = allocation.layer_id AND BINARY layer.business_id = BINARY allocation.business_id
            WHERE BINARY allocation.business_id = BINARY sm.business_id AND allocation.stock_movement_id = sm.id
              AND layer.zero_cost_reason IS NULL
          ))
      ORDER BY sm.created_at DESC, sm.id DESC`,
    [businessId, businessId, businessId, businessId, period.startDate, period.endDateExclusive],
  );
  return buildCogsAuditFindings(rows, period.periodEnd).sort(compareAuditFindingsNewestFirst);
}