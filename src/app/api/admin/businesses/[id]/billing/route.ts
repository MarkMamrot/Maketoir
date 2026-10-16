import { NextResponse } from 'next/server';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getPool, query } from '@/services/MySQLService';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import {
  billingAmountAud, billingAmountCents, BusinessBillingValidationError,
  validateBillingEntries, validatePlanStartDate, type BusinessBillingData,
} from '@/lib/admin/businessBilling';

interface BillingRow extends RowDataPacket {
  billing_month: string;
  payment_plan: string;
  amount_cents: string | number;
  is_paid: number;
  revision: number;
}

async function loadBilling(businessId: string, connection?: PoolConnection): Promise<BusinessBillingData | null> {
  const businessSql = `SELECT DATE_FORMAT(plan_start_date, '%Y-%m-%d') AS planStartDate
    FROM businesses WHERE business_id = ? AND deleted_at IS NULL`;
  const businesses = connection
    ? (await connection.execute<(RowDataPacket & { planStartDate: string | null })[]>(businessSql, [businessId]))[0]
    : await query<{ planStartDate: string | null }>(businessSql, [businessId]);
  if (!businesses[0]) return null;
  const entriesSql = `SELECT billing_month, payment_plan, amount_cents, is_paid, revision
    FROM business_billing_months WHERE business_id = ? ORDER BY billing_month`;
  const rows = connection
    ? (await connection.execute<BillingRow[]>(entriesSql, [businessId]))[0]
    : await query<BillingRow>(entriesSql, [businessId]);
  return {
    planStartDate: businesses[0].planStartDate,
    entries: rows.map(row => ({
      month: row.billing_month, paymentPlan: row.payment_plan,
      amountAud: billingAmountAud(Number(row.amount_cents)),
      paid: Number(row.is_paid) === 1, revision: Number(row.revision),
    })),
  };
}

async function failure(businessId: string, operation: string, error: unknown) {
  await reportRuntimeIssue({
    businessId, source: 'admin_business_billing', operation,
    title: 'Business billing settings failed', error,
    reference: { type: 'business', id: businessId }, context: { operation },
  });
  return NextResponse.json({ error: 'Business billing could not be loaded or saved. Check Runtime Issues and confirm the business billing schema migration has been applied.' }, { status: 500 });
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  try {
    const billing = await loadBilling(params.id);
    return billing ? NextResponse.json({ success: true, billing })
      : NextResponse.json({ error: 'Business not found.' }, { status: 404 });
  } catch (error) {
    return failure(params.id, 'load_monthly_history', error);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  let connection: PoolConnection | undefined;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || !('planStartDate' in body)
      || !('expectedPlanStartDate' in body) || !('entries' in body)) {
      throw new BusinessBillingValidationError('Plan start date, its saved value and monthly entries are required.');
    }
    const planStartDate = validatePlanStartDate(body.planStartDate);
    const expectedDate = validatePlanStartDate(body.expectedPlanStartDate);
    const entries = validateBillingEntries(body.entries);
    connection = await getPool().getConnection();
    await connection.beginTransaction();
    const [businesses] = await connection.execute<(RowDataPacket & { planStartDate: string | null })[]>(
      `SELECT DATE_FORMAT(plan_start_date, '%Y-%m-%d') AS planStartDate
        FROM businesses WHERE business_id = ? AND deleted_at IS NULL FOR UPDATE`, [params.id],
    );
    if (!businesses[0]) {
      await connection.rollback();
      return NextResponse.json({ error: 'Business not found.' }, { status: 404 });
    }
    if (businesses[0].planStartDate !== expectedDate) {
      await connection.rollback();
      return NextResponse.json({ error: 'The plan start date changed elsewhere. Reopen Business Settings before saving.' }, { status: 409 });
    }
    for (const entry of entries) {
      const [existing] = await connection.execute<(RowDataPacket & { revision: number })[]>(
        'SELECT revision FROM business_billing_months WHERE business_id = ? AND billing_month = ? FOR UPDATE',
        [params.id, entry.month],
      );
      if (Number(existing[0]?.revision ?? 0) !== entry.revision) {
        await connection.rollback();
        return NextResponse.json({ error: `${entry.month} was changed elsewhere. Reopen Business Settings before saving.` }, { status: 409 });
      }
      if (!existing[0] && (!planStartDate || entry.month < planStartDate.slice(0, 7))) {
        throw new BusinessBillingValidationError(`${entry.month}: set a plan start date covering this month before adding its payment record.`);
      }
      await connection.execute(
        `INSERT INTO business_billing_months
          (business_id, billing_month, payment_plan, amount_cents, is_paid, created_by_user_id, updated_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE payment_plan = VALUES(payment_plan), amount_cents = VALUES(amount_cents),
           is_paid = VALUES(is_paid), revision = revision + 1, updated_by_user_id = VALUES(updated_by_user_id)`,
        [params.id, entry.month, entry.paymentPlan, billingAmountCents(entry.amountAud), entry.paid ? 1 : 0, auth.user.userId, auth.user.userId],
      );
    }
    await connection.execute('UPDATE businesses SET plan_start_date = ?, updated_at = NOW() WHERE business_id = ?', [planStartDate, params.id]);
    const billing = await loadBilling(params.id, connection);
    await connection.commit();
    return NextResponse.json({ success: true, billing });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error instanceof BusinessBillingValidationError || error instanceof SyntaxError) {
      return NextResponse.json({ error: error instanceof SyntaxError ? 'Enter a valid JSON request.' : error.message }, { status: 400 });
    }
    return failure(params.id, 'save_monthly_history', error);
  } finally {
    connection?.release();
  }
}
