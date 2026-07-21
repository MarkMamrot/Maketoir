import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const tz = process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney';
  const defaultDate = new Date().toLocaleDateString('sv-SE', { timeZone: tz });
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
    register_session_id: number | null; payment_method: string;
    expected_amount: string | null; counted_amount: string | null;
    xero_invoice_id: string | null; xero_synced_at: string | null;
  }[] = [];

  if (sessions.length > 0) {
    const ids = sessions.map(s => s.id);
    reconciliations = await imsQuery(
      `SELECT register_session_id, payment_method, expected_amount, counted_amount,
              xero_invoice_id, xero_synced_at
       FROM pos_eod_reconciliations
       WHERE register_session_id IN (${ids.map(() => '?').join(',')})
       ORDER BY register_session_id, payment_method`,
      ids,
    );
  }

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
      return {
        payment_method: r.payment_method,
        expected_amount: r.expected_amount != null ? exp : null,
        counted_amount:  r.counted_amount  != null ? cnt : null,
        variance:        r.counted_amount  != null ? cnt - exp : null,
        xero_invoice_id: r.xero_invoice_id,
        xero_synced_at:  r.xero_synced_at,
      };
    });
    const totalExpected = recons.reduce((sum, r) => sum + (r.expected_amount ?? 0), 0);
    const totalCounted  = recons.reduce((sum, r) => sum + (r.counted_amount  ?? 0), 0);
    return {
      ...s,
      reconciliations: recons,
      total_expected: totalExpected,
      total_counted:  totalCounted,
      total_variance: totalCounted - totalExpected,
    };
  });

  return NextResponse.json({ success: true, sessions: result, date });
}
