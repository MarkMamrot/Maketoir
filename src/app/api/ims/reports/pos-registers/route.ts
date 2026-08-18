import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const timeZone = await getBusinessTimeZone(session.businessId);
  const defaultDate = new Date().toLocaleDateString('sv-SE', { timeZone });
  const date = searchParams.get('date') ?? defaultDate;
  const biz = session.businessId as string;

  const sessions = await imsQuery<{
    id: number; register_name: string; location_name: string; location_id: number;
    status: string; opened_at: string; opened_by: string | null;
    opening_float: string | null; closed_at: string | null; closed_by: string | null;
  }>(
    `SELECT prs.id, pr.name AS register_name, l.name AS location_name, l.id AS location_id,
            prs.status, prs.opened_at, prs.opened_by, prs.opening_float,
            prs.closed_at, prs.closed_by
     FROM pos_register_sessions prs
     JOIN pos_registers pr ON pr.id = prs.register_id
     JOIN ims_locations l ON l.id = prs.location_id${biz ? ' AND l.business_id = ?' : ''}
     WHERE prs.session_date = ?
     ORDER BY l.name, prs.opened_at ASC`,
    biz ? [biz, date] : [date],
  );

  let reconciliations: {
    id: number;
    register_session_id: number | null; payment_method: string;
    expected_amount: string | null; counted_amount: string | null;
    xero_invoice_id: string | null; xero_synced_at: string | null;
  }[] = [];

  if (sessions.length > 0) {
    const ids = sessions.map(s => s.id);
    reconciliations = await imsQuery(
      `SELECT id, register_session_id, payment_method, expected_amount, counted_amount,
              xero_invoice_id, xero_synced_at
       FROM pos_eod_reconciliations
       WHERE register_session_id IN (${ids.map(() => '?').join(',')})
       ORDER BY register_session_id, payment_method`,
      ids,
    );
  }

  const reconciliationIds = reconciliations.map(reconciliation => reconciliation.id);
  const cashActions = reconciliationIds.length > 0
    ? await query<{
        eod_reconciliation_id: number;
        till_variance: number | string;
        variance_status: string;
        xero_variance_id: string | null;
      }>(
        `SELECT eod_reconciliation_id, till_variance, variance_status, xero_variance_id
           FROM xero_pos_cash_eod_actions
          WHERE business_id = ?
            AND eod_reconciliation_id IN (${reconciliationIds.map(() => '?').join(',')})`,
        [biz, ...reconciliationIds],
      )
    : [];
  const cashActionByReconciliation = new Map(
    cashActions.map(action => [Number(action.eod_reconciliation_id), action]),
  );

  const reconBySession = new Map<number, typeof reconciliations>();
  for (const r of reconciliations) {
    const k = r.register_session_id ?? -1;
    if (!reconBySession.has(k)) reconBySession.set(k, []);
    reconBySession.get(k)!.push(r);
  }

  const result = sessions.map(s => {
    const recons = (reconBySession.get(s.id) ?? []).map(r => {
      const exp = parseFloat(r.expected_amount ?? '0') || 0;
      const cnt = parseFloat(r.counted_amount ?? '0') || 0;
      const openingFloat = parseFloat(s.opening_float ?? '0') || 0;
      const isCash = r.payment_method.trim().toLowerCase() === 'cash';
      const cashAction = cashActionByReconciliation.get(r.id);
      return {
        payment_method: r.payment_method,
        expected_amount: r.expected_amount != null ? exp : null,
        counted_amount:  r.counted_amount  != null ? cnt : null,
        variance:        r.counted_amount  != null ? cnt - (isCash ? openingFloat : 0) - exp : null,
        xero_invoice_id: r.xero_invoice_id,
        xero_synced_at:  r.xero_synced_at,
        till_variance: cashAction ? Number(cashAction.till_variance) : null,
        variance_status: cashAction?.variance_status ?? null,
        xero_variance_id: cashAction?.xero_variance_id ?? null,
      };
    });
    const totalExpected = recons.reduce((sum, r) => sum + (r.expected_amount ?? 0), 0);
    const totalCounted  = recons.reduce((sum, r) => sum + (r.counted_amount  ?? 0), 0);
    const totalVariance = recons.reduce((sum, r) => sum + (r.variance ?? 0), 0);
    return {
      ...s,
      reconciliations: recons,
      total_expected: totalExpected,
      total_counted:  totalCounted,
      total_variance: totalVariance,
    };
  });

  return NextResponse.json({ success: true, sessions: result, date });
}
