import { NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { requireAdminTier } from '@/lib/sessionUtils';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getIMSPool } from '@/services/IMSMySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { parseOpeningFloat } from '@/lib/pos/registerFloatCorrection';
import { closingVariance, parseClosingAmount } from '@/lib/pos/registerClosingCorrection';

type RegisterRow = RowDataPacket & {
  id: number; status: string; opening_float: string | null;
  register_name: string; location_name: string; session_date: string;
};
type ReconciliationRow = RowDataPacket & {
  id: number; payment_method: string; expected_amount: string | null; counted_amount: string | null;
  xero_invoice_id: string | null;
};
type Entry = { id: number; previousCount: number | null; expectedAmount: number | null; countedAmount: number | null };
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const nullableAmount = (value: unknown) => value === null || parseClosingAmount(value) !== null;

function parseEntries(value: unknown): Entry[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 100) return null;
  const entries: Entry[] = [];
  for (const entry of value) {
    if (!entry || !positiveId(entry.id) || !nullableAmount(entry.previousCount)
      || !nullableAmount(entry.expectedAmount) || !nullableAmount(entry.countedAmount)
      || (entry.countedAmount === null && entry.previousCount !== null)) return null;
    entries.push({
      id: entry.id,
      previousCount: entry.previousCount === null ? null : parseClosingAmount(entry.previousCount),
      expectedAmount: entry.expectedAmount === null ? null : parseClosingAmount(entry.expectedAmount),
      countedAmount: entry.countedAmount === null ? null : parseClosingAmount(entry.countedAmount),
    });
  }
  return new Set(entries.map(entry => entry.id)).size === entries.length ? entries : null;
}

export async function PATCH(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  const float = body?.previousFloat === null ? null : parseOpeningFloat(body?.previousFloat);
  const entries = parseEntries(body?.entries);
  if (!positiveId(body?.sessionId) || !entries || !reason || reason.length > 1000
    || (body?.previousFloat !== null && float === null) || body?.acknowledgeAccounting !== true) {
    return NextResponse.json({ error: 'Provide the session, valid closing counts (up to two decimal places), a reason and accounting acknowledgement.' }, { status: 400 });
  }
  try {
    return await runImsForBusiness(user.businessId, async () => {
      const connection = await getIMSPool().getConnection();
      try {
        await connection.beginTransaction();
        const [registers] = await connection.query<RegisterRow[]>(
          `SELECT prs.id, prs.status, prs.opening_float, prs.session_date,
                  pr.name AS register_name, l.name AS location_name
             FROM pos_register_sessions prs
             JOIN pos_registers pr ON pr.id = prs.register_id
             JOIN ims_locations l ON l.id = prs.location_id
            WHERE prs.id = ? AND l.business_id = ? FOR UPDATE`,
          [body.sessionId, user.businessId],
        );
        const register = registers[0];
        if (!register) {
          await connection.rollback();
          return NextResponse.json({ error: 'Register session not found.' }, { status: 404 });
        }
        const savedFloat = register.opening_float === null ? null : Number(register.opening_float);
        if (register.status !== 'closed' || savedFloat !== float) {
          await connection.rollback();
          return NextResponse.json({ error: 'Only closed sessions can have closing totals corrected. Reload the report before editing.' }, { status: 409 });
        }
        const [rows] = await connection.query<ReconciliationRow[]>(
          `SELECT id, payment_method, expected_amount, counted_amount, xero_invoice_id
             FROM pos_eod_reconciliations WHERE register_session_id = ? ORDER BY id FOR UPDATE`,
          [register.id],
        );
        const byId = new Map(entries.map(entry => [entry.id, entry]));
        if (rows.length !== entries.length || rows.some(row => {
          const entry = byId.get(row.id);
          return !entry || entry.previousCount !== (row.counted_amount === null ? null : Number(row.counted_amount))
            || entry.expectedAmount !== (row.expected_amount === null ? null : Number(row.expected_amount));
        })) {
          await connection.rollback();
          return NextResponse.json({ error: 'Closing counts changed. Reload the report before editing.' }, { status: 409 });
        }
        if (rows.some(row => row.payment_method.trim().toLowerCase() === 'cash' && (byId.get(row.id)!.countedAmount ?? 0) < 0)) {
          await connection.rollback();
          return NextResponse.json({ error: 'Counted cash cannot be negative.' }, { status: 400 });
        }
        const changed = rows.filter(row => byId.get(row.id)!.countedAmount !== (row.counted_amount === null ? null : Number(row.counted_amount)));
        if (!changed.length) {
          await connection.rollback();
          return NextResponse.json({ error: 'Enter at least one different closing count.' }, { status: 400 });
        }
        const snapshot = changed.map(row => {
          const previousCount = row.counted_amount === null ? null : Number(row.counted_amount);
          const counted = byId.get(row.id)!.countedAmount;
          const expected = row.expected_amount === null ? null : Number(row.expected_amount);
          const openingFloat = row.payment_method.trim().toLowerCase() === 'cash' ? savedFloat ?? 0 : 0;
          return {
            id: row.id, payment_method: row.payment_method, previous_counted: previousCount, counted_amount: counted,
            expected_amount: expected, opening_float: openingFloat,
            previous_variance: closingVariance(previousCount, expected, openingFloat),
            variance: closingVariance(counted, expected, openingFloat), xero_invoice_id: row.xero_invoice_id,
          };
        });
        for (const row of snapshot) {
          await connection.execute(
            'UPDATE pos_eod_reconciliations SET counted_amount = ?, denomination_data = NULL WHERE id = ? AND register_session_id = ?',
            [row.counted_amount, row.id, register.id],
          );
        }
        const [insert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO pos_register_closing_corrections
             (register_session_id, business_id, reason, actor_id, actor_name, register_name, location_name, session_date, counts_snapshot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [register.id, user.businessId, reason, user.userId, user.name, register.register_name,
            register.location_name, register.session_date, JSON.stringify(snapshot)],
        );
        await connection.commit();
        return NextResponse.json({ success: true, correctionId: insert.insertId });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: user.businessId, source: 'pos_register_closing', operation: 'correct_closing_counts',
      title: 'Register closing count correction failed', error,
      reference: { type: 'register_session', id: body.sessionId },
    });
    return NextResponse.json({ error: 'Closing counts could not be corrected. Reload the report to check the saved values.' }, { status: 500 });
  }
}
