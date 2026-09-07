import { imsQuery } from '@/services/IMSMySQLService';
import { PosEodRepo, PosRegisterSessionRepo } from '@/lib/db/PosRepository';

export interface PosAssistantScope {
  businessId: string;
  locationId: number;
  registerId: number;
}

async function validatePosRegister(scope: PosAssistantScope) {
  const rows = await imsQuery<any>(
    `SELECT r.id, r.name, l.id AS location_id, l.name AS location_name
       FROM pos_registers r
       JOIN ims_locations l
         ON l.id = r.location_id AND l.business_id = ? AND l.is_active = 1
      WHERE r.id = ? AND r.location_id = ? AND r.is_active = 1
      LIMIT 1`,
    [scope.businessId, scope.registerId, scope.locationId],
  );
  return rows[0] ?? null;
}

export async function loadPosRegisterStatus(scope: PosAssistantScope) {
  const register = await validatePosRegister(scope);
  if (!register) return null;

  const session = await PosRegisterSessionRepo.getCurrent(scope.registerId);
  if (session && session.location_id !== scope.locationId) return null;
  if (!session) {
    return {
      registerId: scope.registerId,
      register: register.name,
      locationId: scope.locationId,
      location: register.location_name,
      status: 'closed' as const,
      session: null,
    };
  }

  const fallback = { locationId: scope.locationId, date: session.session_date, registerId: scope.registerId };
  const [totals, expectedByMethod, pettyCashRows, reconciliationRows] = await Promise.all([
    PosEodRepo.getDayTotalsBySession(session.id, fallback),
    PosEodRepo.getExpectedBySession(session.id, fallback),
    imsQuery<any>(
      `SELECT COALESCE(SUM(amount), 0) AS amount
         FROM pos_petty_cash_transactions
        WHERE business_id = ? AND location_id = ? AND register_id = ?
          AND register_session_id = ? AND status = 'recorded'`,
      [scope.businessId, scope.locationId, scope.registerId, Number(session.id)],
    ),
    PosEodRepo.getBySession(session.id, fallback),
  ]);

  const pettyCash = Number(pettyCashRows[0]?.amount ?? 0);

  return {
    registerId: scope.registerId,
    register: register.name,
    locationId: scope.locationId,
    location: register.location_name,
    status: 'open' as const,
    session: {
      sessionId: Number(session.id),
      sessionDate: String(session.session_date).slice(0, 10),
      openedAt: session.opened_at,
      openingFloat: Number(session.opening_float ?? 0),
      saleCount: totals.sale_count,
      salesTotalTaxInclusive: totals.total_inc_tax,
      gst: totals.tax_total,
      salesTotalTaxExclusive: totals.total_exc_tax,
      pettyCash,
      expectedByPaymentMethod: expectedByMethod,
      countsSaved: reconciliationRows.length > 0 && reconciliationRows.some(row => row.counted_amount != null),
      countedPaymentMethods: reconciliationRows.filter(row => row.counted_amount != null).length,
    },
  };
}

export interface PosRecentTransactionsInput extends PosAssistantScope {
  days: number;
  limit?: number;
}

export async function loadPosRecentTransactions(input: PosRecentTransactionsInput) {
  const register = await validatePosRegister(input);
  if (!register) return null;
  const days = Math.min(30, Math.max(1, Math.round(Number(input.days) || 7)));
  const limit = Math.min(20, Math.max(1, input.limit ?? 20));
  const rows = await imsQuery<any>(
    `SELECT s.id, s.sale_type, s.status, s.total, s.tax_total, s.discount_total, s.completed_at,
            (SELECT COUNT(*) FROM pos_sale_items i WHERE i.sale_id = s.id AND i.business_id = ?) AS line_count,
            (SELECT COALESCE(SUM(i.qty), 0) FROM pos_sale_items i WHERE i.sale_id = s.id AND i.business_id = ?) AS unit_count,
            (SELECT GROUP_CONCAT(DISTINCT p.payment_method ORDER BY p.payment_method SEPARATOR ', ')
               FROM pos_payments p WHERE p.sale_id = s.id AND p.business_id = ?) AS payment_methods
       FROM pos_sales s
      WHERE ((s.business_id = ? AND s.location_id = ? AND s.register_id = ?)
        OR (s.business_id = ? AND s.location_id = ? AND EXISTS (
          SELECT 1 FROM pos_register_sessions rs
           WHERE rs.id = s.register_session_id AND rs.register_id = ? AND rs.location_id = ?
        )))
        AND s.status IN ('completed', 'layby_complete')
        AND s.completed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY s.completed_at DESC, s.id DESC
      LIMIT ${limit + 1}`,
    [input.businessId, input.businessId, input.businessId,
      input.businessId, input.locationId, input.registerId,
        input.businessId, input.locationId, input.registerId, input.locationId,
        days],
  );

  return {
    registerId: input.registerId,
    register: register.name,
    locationId: input.locationId,
    location: register.location_name,
    days,
    rows: rows.slice(0, limit).map(row => ({
      saleId: Number(row.id),
      saleType: row.sale_type,
      status: row.status,
      totalTaxInclusive: Number(row.total ?? 0),
      gst: Number(row.tax_total ?? 0),
      discountTotal: Number(row.discount_total ?? 0),
      lineCount: Number(row.line_count ?? 0),
      unitCount: Number(row.unit_count ?? 0),
      paymentMethods: String(row.payment_methods ?? '').split(',').map(value => value.trim()).filter(Boolean),
      completedAt: row.completed_at,
    })),
    truncated: rows.length > limit,
  };
}
