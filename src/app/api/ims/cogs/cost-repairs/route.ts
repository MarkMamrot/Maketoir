import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { normalizeCogsCostRepairs, parseForeignCostHints } from '@/lib/ims/cogsCostRepair';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { calculateCogsForPeriod } from '@/lib/xero/cogsCalculator';
import { getIMSPool, imsQuery } from '@/services/IMSMySQLService';

interface RepairMovementRow {
  id: number; variant_id: string; sku: string | null; product_name: string; location_name: string;
  movement_type: string; reference_type: string; reference_id: number | null; qty_change: number | string;
  unit_cost: number | string | null; cost_method_snapshot: 'average_cost' | 'fifo'; created_at: string | Date;
  cost_aud: number | string | null; avg_cost: number | string | null; cost_foreign: string | null;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function period(request: Request): { from: string; toExclusive: string } {
  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? '';
  const toExclusive = url.searchParams.get('toExclusive') ?? '';
  if (!validDate(from) || !validDate(toExclusive) || from >= toExclusive) throw new Error('Choose a valid completed accounting period.');
  return { from, toExclusive };
}

export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ success: false, error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = String(session.businessId);
  try {
    const { from, toExclusive } = period(request);
    const rows = await imsQuery<RepairMovementRow>(
      `SELECT sm.id, sm.variant_id, v.sku, p.name AS product_name, COALESCE(l.name, 'Unknown location') AS location_name,
              sm.movement_type, sm.reference_type, sm.reference_id, sm.qty_change, sm.unit_cost,
              sm.cost_method_snapshot, sm.created_at, v.cost_aud, v.avg_cost, v.cost_foreign
         FROM ims_stock_movements sm
         JOIN ims_product_variants v ON BINARY v.variant_id = BINARY sm.variant_id AND BINARY v.business_id = BINARY sm.business_id
         JOIN ims_products p ON BINARY p.product_id = BINARY v.product_id AND BINARY p.business_id = BINARY sm.business_id AND p.is_stock_item = 1
         LEFT JOIN ims_locations l ON l.id = sm.location_id AND BINARY l.business_id = BINARY sm.business_id
         LEFT JOIN ims_credit_notes cn ON sm.movement_type IN ('cn_returned','cn_return_reversed') AND sm.reference_type = 'credit_note'
           AND cn.id = sm.reference_id AND BINARY cn.business_id = BINARY sm.business_id
         LEFT JOIN pos_sales ps ON ((sm.movement_type = 'pos_sale' AND sm.reference_type = 'pos_sale' AND ps.id = sm.reference_id)
           OR (cn.source = 'pos' AND ps.id = cn.pos_sale_id)) AND BINARY ps.business_id = BINARY sm.business_id
         LEFT JOIN ims_sales_orders so ON ((sm.movement_type = 'so_fulfilled' AND sm.reference_type = 'sales_order' AND so.id = sm.reference_id)
           OR (cn.so_id IS NOT NULL AND so.id = cn.so_id)) AND BINARY so.business_id = BINARY sm.business_id
        WHERE BINARY sm.business_id = BINARY ? AND sm.created_at >= ? AND sm.created_at < ?
          AND sm.movement_type IN ('pos_sale','so_fulfilled','cn_returned','cn_return_reversed')
          AND (sm.unit_cost IS NULL OR sm.unit_cost <= 0)
          AND ((sm.movement_type = 'pos_sale' AND ps.id IS NOT NULL AND COALESCE(ps.is_historical, 0) = 0)
            OR (sm.movement_type = 'so_fulfilled' AND so.id IS NOT NULL AND COALESCE(so.is_historical, 0) = 0 AND so.cin7_order_id IS NULL)
            OR (sm.movement_type IN ('cn_returned','cn_return_reversed') AND cn.id IS NOT NULL
              AND (cn.source <> 'pos' OR COALESCE(ps.is_historical, 0) = 0)
              AND (cn.so_id IS NULL OR (COALESCE(so.is_historical, 0) = 0 AND so.cin7_order_id IS NULL))))
              AND NOT (sm.unit_cost <= 0 AND sm.cost_method_snapshot = 'fifo'
            AND (EXISTS (SELECT 1 FROM ims_fifo_cost_allocations za JOIN ims_fifo_cost_layers zl
               ON zl.id = za.layer_id AND BINARY zl.business_id = BINARY za.business_id
              WHERE BINARY za.business_id = BINARY sm.business_id AND za.stock_movement_id = sm.id AND zl.zero_cost_reason IS NOT NULL)
              OR EXISTS (SELECT 1 FROM ims_fifo_cost_layers zsl WHERE BINARY zsl.business_id = BINARY sm.business_id
              AND zsl.source_movement_id = sm.id AND zsl.zero_cost_reason IS NOT NULL))
            AND NOT EXISTS (SELECT 1 FROM ims_fifo_cost_allocations ua JOIN ims_fifo_cost_layers ul
               ON ul.id = ua.layer_id AND BINARY ul.business_id = BINARY ua.business_id
              WHERE BINARY ua.business_id = BINARY sm.business_id AND ua.stock_movement_id = sm.id AND ul.zero_cost_reason IS NULL)
            AND NOT EXISTS (SELECT 1 FROM ims_fifo_cost_layers usl WHERE BINARY usl.business_id = BINARY sm.business_id
              AND usl.source_movement_id = sm.id AND usl.zero_cost_reason IS NULL))
        ORDER BY sm.created_at, sm.id`,
      [businessId, from, toExclusive],
    );
    return NextResponse.json({ success: true, from, toExclusive, movements: rows.map(row => ({
      id: Number(row.id), variantId: row.variant_id, sku: row.sku, productName: row.product_name, locationName: row.location_name,
      movementType: row.movement_type, referenceType: row.reference_type, referenceId: row.reference_id,
      quantity: Math.abs(Number(row.qty_change)), unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
      costMethod: row.cost_method_snapshot, occurredAt: row.created_at,
      suggestions: {
        costAud: Number(row.cost_aud) > 0 ? Number(row.cost_aud) : null,
        averageCost: Number(row.avg_cost) > 0 ? Number(row.avg_cost) : null,
        foreign: parseForeignCostHints(row.cost_foreign),
      },
    })) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('Choose a valid')) return NextResponse.json({ success: false, error: message }, { status: 400 });
    await reportRuntimeIssue({ businessId, source: 'ims_cogs_repair', operation: 'list_missing_costs',
      title: 'Missing COGS movement costs could not be loaded', error }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Unable to load missing COGS movement costs.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ success: false, error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = String(session.businessId);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid request body.' }, { status: 400 }); }
  const from = String(body.from ?? '');
  const toExclusive = String(body.toExclusive ?? '');
  let repairs;
  try {
    if (!validDate(from) || !validDate(toExclusive) || from >= toExclusive) throw new Error('Choose a valid completed accounting period.');
    repairs = normalizeCogsCostRepairs(body.repairs);
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Invalid repair request.' }, { status: 400 });
  }

  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const placeholders = repairs.map(() => '?').join(',');
    const [rows] = await connection.execute(
      `SELECT sm.id, sm.unit_cost, sm.cost_method_snapshot, sm.created_at
         FROM ims_stock_movements sm
         JOIN ims_product_variants v ON BINARY v.variant_id = BINARY sm.variant_id AND BINARY v.business_id = BINARY sm.business_id
         JOIN ims_products p ON BINARY p.product_id = BINARY v.product_id AND BINARY p.business_id = BINARY sm.business_id AND p.is_stock_item = 1
         LEFT JOIN ims_credit_notes cn ON sm.movement_type IN ('cn_returned','cn_return_reversed') AND sm.reference_type = 'credit_note'
           AND cn.id = sm.reference_id AND BINARY cn.business_id = BINARY sm.business_id
         LEFT JOIN pos_sales ps ON ((sm.movement_type = 'pos_sale' AND sm.reference_type = 'pos_sale' AND ps.id = sm.reference_id)
           OR (cn.source = 'pos' AND ps.id = cn.pos_sale_id)) AND BINARY ps.business_id = BINARY sm.business_id
         LEFT JOIN ims_sales_orders so ON ((sm.movement_type = 'so_fulfilled' AND sm.reference_type = 'sales_order' AND so.id = sm.reference_id)
           OR (cn.so_id IS NOT NULL AND so.id = cn.so_id)) AND BINARY so.business_id = BINARY sm.business_id
        WHERE BINARY sm.business_id = BINARY ? AND sm.id IN (${placeholders})
          AND sm.movement_type IN ('pos_sale','so_fulfilled','cn_returned','cn_return_reversed')
          AND (sm.unit_cost IS NULL OR sm.unit_cost <= 0)
          AND ((sm.movement_type = 'pos_sale' AND ps.id IS NOT NULL AND COALESCE(ps.is_historical, 0) = 0)
            OR (sm.movement_type = 'so_fulfilled' AND so.id IS NOT NULL AND COALESCE(so.is_historical, 0) = 0 AND so.cin7_order_id IS NULL)
            OR (sm.movement_type IN ('cn_returned','cn_return_reversed') AND cn.id IS NOT NULL
              AND (cn.source <> 'pos' OR COALESCE(ps.is_historical, 0) = 0)
              AND (cn.so_id IS NULL OR (COALESCE(so.is_historical, 0) = 0 AND so.cin7_order_id IS NULL))))
          AND NOT (sm.unit_cost <= 0 AND sm.cost_method_snapshot = 'fifo'
            AND (EXISTS (SELECT 1 FROM ims_fifo_cost_allocations za JOIN ims_fifo_cost_layers zl
                   ON zl.id = za.layer_id AND BINARY zl.business_id = BINARY za.business_id
                  WHERE BINARY za.business_id = BINARY sm.business_id AND za.stock_movement_id = sm.id AND zl.zero_cost_reason IS NOT NULL)
              OR EXISTS (SELECT 1 FROM ims_fifo_cost_layers zsl WHERE BINARY zsl.business_id = BINARY sm.business_id
                  AND zsl.source_movement_id = sm.id AND zsl.zero_cost_reason IS NOT NULL))
            AND NOT EXISTS (SELECT 1 FROM ims_fifo_cost_allocations ua JOIN ims_fifo_cost_layers ul
                   ON ul.id = ua.layer_id AND BINARY ul.business_id = BINARY ua.business_id
                  WHERE BINARY ua.business_id = BINARY sm.business_id AND ua.stock_movement_id = sm.id AND ul.zero_cost_reason IS NULL)
            AND NOT EXISTS (SELECT 1 FROM ims_fifo_cost_layers usl WHERE BINARY usl.business_id = BINARY sm.business_id
                  AND usl.source_movement_id = sm.id AND usl.zero_cost_reason IS NULL))
        FOR UPDATE`,
      [businessId, ...repairs.map(repair => repair.movementId)],
    );
    const current = new Map((rows as Array<{ id: number; unit_cost: number | string | null; cost_method_snapshot: string; created_at: string | Date }>).map(row => [Number(row.id), row]));
    if (current.size !== repairs.length) throw new Error('One or more movements no longer exist or do not belong to this business.');
    for (const repair of repairs) {
      const row = current.get(repair.movementId)!;
      const movementDate = (row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)).slice(0, 10);
      if (movementDate < from || movementDate >= toExclusive) throw new Error(`Movement ${repair.movementId} is outside the selected period.`);
      const currentCost = row.unit_cost == null ? null : Number(row.unit_cost);
      if (currentCost !== repair.expectedUnitCost) throw new Error(`Movement ${repair.movementId} changed while you were reviewing it. Refresh and try again.`);
      if (currentCost != null && currentCost > 0) throw new Error(`Movement ${repair.movementId} already has a positive cost.`);
      if (row.cost_method_snapshot === 'fifo' && !repair.fifoWarningAccepted) throw new Error(`Movement ${repair.movementId} requires FIFO impact acknowledgement.`);
      await connection.execute(
        `INSERT INTO ims_cogs_cost_repairs
           (business_id, movement_id, old_unit_cost, new_unit_cost, cost_source, source_detail, reason,
            fifo_warning_accepted, actor_id, actor_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [businessId, repair.movementId, currentCost, repair.newUnitCost, repair.source,
          repair.sourceDetail ? JSON.stringify(repair.sourceDetail) : null, repair.reason,
          row.cost_method_snapshot === 'fifo' ? 1 : 0, session.userId ?? null, session.name ?? session.email ?? null],
      );
      await connection.execute(
        'UPDATE ims_stock_movements SET unit_cost = ? WHERE BINARY business_id = BINARY ? AND id = ?',
        [repair.newUnitCost, businessId, repair.movementId],
      );
    }
    await connection.commit();
  } catch (error: unknown) {
    await connection.rollback().catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    const expected = /no longer exist|outside the selected period|changed while|already has|requires FIFO/.test(message);
    if (!expected) await reportRuntimeIssue({ businessId, source: 'ims_cogs_repair', operation: 'save_movement_costs',
      title: 'COGS movement cost repairs could not be saved', error, context: { from, toExclusive, movementIds: repairs.map(repair => repair.movementId) } }).catch(() => {});
    return NextResponse.json({ success: false, error: expected ? message : 'Unable to save COGS movement costs.' }, { status: expected ? 409 : 500 });
  } finally { connection.release(); }

  const calculation = await calculateCogsForPeriod({ businessId, startDate: from, endDateExclusive: toExclusive });
  return NextResponse.json({ success: true, repaired: repairs.length, calculation });
}