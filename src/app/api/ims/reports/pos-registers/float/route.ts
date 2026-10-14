import { NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { requireAdminTier } from '@/lib/sessionUtils';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getIMSPool } from '@/services/IMSMySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { cashFloatSnapshot, parseOpeningFloat, renderFloatCorrectionEmail, type CashFloatSnapshot } from '@/lib/pos/registerFloatCorrection';
import { getXeroReconciliationRecipients } from '@/lib/xero/reconciliation/repository';
import { parseReconciliationRecipients, sendReconciliationEmail } from '@/lib/xero/reconciliation/email';

type RegisterRow = RowDataPacket & {
  id: number; status: string; opening_float: string | null; session_date: string;
  register_name: string; location_name: string;
};
type CashRow = RowDataPacket & {
  id: number; expected_amount: string | null; counted_amount: string | null;
  opening_float: string | null; xero_invoice_id: string | null;
};
type CorrectionRow = RowDataPacket & {
  id: number; session_status: string; email_sent_at: string | null;
  register_name: string; location_name: string; session_date: string;
  previous_float: string | null; opening_float: string; actor_name: string;
  reason: string; created_at: string; cash_snapshot: string | CashFloatSnapshot[];
};
const positiveId = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export async function PATCH(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const body = await request.json().catch(() => null);
  const amount = parseOpeningFloat(body?.openingFloat);
  const previous = body?.previousFloat === null ? null : parseOpeningFloat(body?.previousFloat);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!positiveId(body?.sessionId) || amount == null || !reason || reason.length > 1000
    || !['open', 'closed'].includes(body?.status)
    || (body?.previousFloat !== null && previous == null)) {
    return NextResponse.json({ error: 'Provide a valid session, opening float (up to two decimal places) and correction reason.' }, { status: 400 });
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
        const savedFloat = register.opening_float == null ? null : Number(register.opening_float);
        if (register.status !== body.status || savedFloat !== previous) {
          await connection.rollback();
          return NextResponse.json({ error: 'The register changed. Reload the report before editing its float.' }, { status: 409 });
        }
        if (register.status === 'closed' && body.acknowledgeAccounting !== true) {
          await connection.rollback();
          return NextResponse.json({ error: 'Acknowledge that the bookkeeper must manually correct affected accounting syncs.' }, { status: 400 });
        }
        if (savedFloat === amount) {
          await connection.rollback();
          return NextResponse.json({ error: 'Enter a different opening float.' }, { status: 400 });
        }
        const [cashRows] = await connection.query<CashRow[]>(
          `SELECT id, expected_amount, counted_amount, opening_float, xero_invoice_id
             FROM pos_eod_reconciliations
            WHERE register_session_id = ? AND LOWER(TRIM(payment_method)) = 'cash' FOR UPDATE`,
          [register.id],
        );
        const cash = cashRows.map(row => cashFloatSnapshot(row, amount));
        await connection.execute(
          'UPDATE pos_register_sessions SET opening_float = ?, denomination_data = NULL WHERE id = ?',
          [amount, register.id],
        );
        await connection.execute(
          `UPDATE pos_eod_reconciliations SET opening_float = ?
            WHERE register_session_id = ? AND LOWER(TRIM(payment_method)) = 'cash'`,
          [amount, register.id],
        );
        const [insert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO pos_register_float_corrections
             (register_session_id, business_id, previous_float, opening_float, session_status,
              reason, actor_id, actor_name, register_name, location_name, session_date, cash_snapshot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [register.id, user.businessId, savedFloat, amount, register.status, reason,
            user.userId, user.name, register.register_name, register.location_name, register.session_date, JSON.stringify(cash)],
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
      businessId: user.businessId, source: 'pos_register_float', operation: 'correct_float',
      title: 'Register opening float correction failed', error,
      reference: { type: 'register_session', id: body.sessionId },
    });
    return NextResponse.json({ error: 'The opening float could not be corrected. Reload the report to check its saved value.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { user, response } = requireAdminTier();
  if (response) return response;
  const body = await request.json().catch(() => null);
  if (!positiveId(body?.correctionId)) return NextResponse.json({ error: 'A saved correction is required.' }, { status: 400 });
  try {
    return await runImsForBusiness(user.businessId, async () => {
      const connection = await getIMSPool().getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.query<CorrectionRow[]>(
          'SELECT * FROM pos_register_float_corrections WHERE id = ? AND business_id = ? FOR UPDATE',
          [body.correctionId, user.businessId],
        );
        const correction = rows[0];
        if (!correction || correction.session_status !== 'closed') {
          await connection.rollback();
          return NextResponse.json({ error: 'Closed-register correction not found.' }, { status: 404 });
        }
        if (correction.email_sent_at) {
          await connection.rollback();
          return NextResponse.json({ success: true, alreadySent: true });
        }
        const { recipients, invalid } = parseReconciliationRecipients(await getXeroReconciliationRecipients(user.businessId));
        if (!recipients.length || invalid.length) {
          await connection.rollback();
          return NextResponse.json({ error: 'Configure valid bookkeeping/accounts email recipients in General Settings first.' }, { status: 409 });
        }
        const cash: CashFloatSnapshot[] = typeof correction.cash_snapshot === 'string'
          ? JSON.parse(correction.cash_snapshot) : correction.cash_snapshot;
        const email = renderFloatCorrectionEmail({ ...correction, cash });
        const messageId = await sendReconciliationEmail({
          ...email, recipients, idempotencyKey: `register-float-${user.businessId}-${correction.id}`,
        });
        await connection.execute(
          `UPDATE pos_register_float_corrections
              SET email_sent_at = UTC_TIMESTAMP(), email_recipients = ?, provider_message_id = ?
            WHERE id = ? AND business_id = ?`,
          [JSON.stringify(recipients), messageId, correction.id, user.businessId],
        );
        await connection.commit();
        return NextResponse.json({ success: true, recipientCount: recipients.length });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: user.businessId, source: 'pos_register_float', operation: 'email_bookkeeper',
      title: 'Register float correction email failed', error,
      reference: { type: 'register_float_correction', id: body.correctionId },
    });
    return NextResponse.json({ error: 'The bookkeeper email could not be confirmed as sent. The float correction remains saved; retry the email separately.' }, { status: 500 });
  }
}
