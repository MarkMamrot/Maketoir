import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

import { buildCashDepositConfirmationPlan } from '@/lib/ims/cashDepositConfirmation';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminTier } from '@/lib/sessionUtils';
import { getPool } from '@/services/MySQLService';
import { xeroApiFetch } from '@/services/XeroService';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const money = (value: unknown) => Math.round(Number(value) * 100) / 100;
const actionKey = (businessId: string, depositId: number, type: string, date = '') =>
  crypto.createHash('sha256').update(`${businessId}:cash-deposit:${depositId}:${type}:${date}`).digest('hex');

export async function POST(request: Request, { params }: { params: { depositId: string } }) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const depositId = Number(params.depositId);
  const body = await request.json();
  const lodgementDate = typeof body.lodgementDate === 'string' ? body.lodgementDate : '';
  const bankReference = typeof body.bankReference === 'string' ? body.bankReference.trim() : '';
  const destinationAccountId = typeof body.destinationAccountId === 'string' ? body.destinationAccountId.trim() : '';
  const depositedTotal = money(body.depositedTotal);
  if (!Number.isInteger(depositId) || depositId <= 0 || !DATE_PATTERN.test(lodgementDate)
    || !destinationAccountId || !Number.isFinite(depositedTotal) || depositedTotal < 0) {
    return NextResponse.json({ error: 'Lodgement date, destination bank, and a valid final deposited amount are required' }, { status: 400 });
  }

  let accountResponse: any;
  try {
    accountResponse = await xeroApiFetch(auth.user.businessId, `/Accounts/${encodeURIComponent(destinationAccountId)}`);
  } catch (error: any) {
    await reportRuntimeIssue({
      businessId: auth.user.businessId,
      source: 'ims.cash_banking',
      operation: 'confirm-destination-account',
      title: 'Cash deposit destination validation failed',
      error,
      context: { depositId, destinationAccountId },
    }).catch(() => {});
    return NextResponse.json({ error: error?.message ?? 'Could not validate the destination bank' }, { status: 502 });
  }
  const destination = (accountResponse?.Accounts ?? []).find((account: any) =>
    account.AccountID === destinationAccountId && account.Status === 'ACTIVE' && account.Type === 'BANK');
  if (!destination || !String(destination.Code ?? '').trim()) {
    return NextResponse.json({ error: 'Select an active coded Xero bank account' }, { status: 400 });
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows]: any = await connection.execute(
      `SELECT id, counted_total, over_short_account_code, confirmation_status, status,
              lodgement_date, destination_account_id, deposited_total
         FROM xero_cash_deposits
        WHERE business_id = ? AND id = ? FOR UPDATE`,
      [auth.user.businessId, depositId],
    );
    const deposit = rows[0];
    if (!deposit) {
      await connection.rollback();
      return NextResponse.json({ error: 'Cash deposit not found' }, { status: 404 });
    }
    if (deposit.confirmation_status === 'confirmed') {
      const same = String(deposit.lodgement_date).slice(0, 10) === lodgementDate
        && deposit.destination_account_id === destinationAccountId
        && Math.abs(Number(deposit.deposited_total) - depositedTotal) < 0.005;
      await connection.rollback();
      return same
        ? NextResponse.json({ success: true, depositId, replayed: true })
        : NextResponse.json({ error: 'This deposit has already been confirmed with different details' }, { status: 409 });
    }
    if (deposit.status !== 'draft') {
      await connection.rollback();
      return NextResponse.json({ error: 'Only an unposted draft can be confirmed' }, { status: 409 });
    }
    const [days]: any = await connection.execute(
      `SELECT business_date, banking_variance FROM xero_cash_deposit_days
        WHERE business_id = ? AND cash_deposit_id = ? ORDER BY business_date`,
      [auth.user.businessId, depositId],
    );
    const confirmationPlan = buildCashDepositConfirmationPlan({
      preparedTotal: deposit.counted_total,
      depositedTotal,
      days,
    });
    const preparationVariances = confirmationPlan.preparationVariances;
    const bankVariance = confirmationPlan.bankAcceptanceVariance;
    if ((preparationVariances.length > 0 || bankVariance !== 0) && !deposit.over_short_account_code) {
      await connection.rollback();
      return NextResponse.json({ error: 'Cash Variances account is required before confirming this deposit' }, { status: 409 });
    }

    await connection.execute(
      `UPDATE xero_cash_deposits
          SET lodgement_date = ?, bank_reference = ?, destination_account_id = ?,
              destination_account_code = ?, destination_account_name = ?, deposited_total = ?,
              bank_variance_total = ?, confirmation_status = 'confirmed',
              confirmed_by_user_id = ?, confirmed_by_name = ?, confirmed_at = NOW(), error_detail = NULL
        WHERE business_id = ? AND id = ?`,
      [lodgementDate, bankReference || null, destination.AccountID, String(destination.Code), destination.Name,
        depositedTotal, bankVariance, auth.user.userId, auth.user.name, auth.user.businessId, depositId],
    );
    for (const day of preparationVariances) {
      const date = day.businessDate;
      const amount = day.amount;
      await connection.execute(
        `INSERT INTO xero_cash_deposit_actions
         (cash_deposit_id, business_id, action_key, action_type, business_date, amount, idempotency_key)
         VALUES (?, ?, ?, 'preparation_variance', ?, ?, ?)`,
        [depositId, auth.user.businessId, `${depositId}:preparation_variance:${date}`, date, amount,
          actionKey(auth.user.businessId, depositId, 'preparation_variance', date)],
      );
    }
    if (bankVariance !== 0) {
      await connection.execute(
        `INSERT INTO xero_cash_deposit_actions
         (cash_deposit_id, business_id, action_key, action_type, business_date, amount, idempotency_key)
         VALUES (?, ?, ?, 'bank_acceptance_variance', ?, ?, ?)`,
        [depositId, auth.user.businessId, `${depositId}:bank_acceptance_variance`, lodgementDate, bankVariance,
          actionKey(auth.user.businessId, depositId, 'bank_acceptance_variance')],
      );
    }
    await connection.execute(
      `INSERT INTO xero_cash_deposit_actions
       (cash_deposit_id, business_id, action_key, action_type, amount, idempotency_key)
       VALUES (?, ?, ?, 'bank_transfer', ?, ?)`,
      [depositId, auth.user.businessId, `${depositId}:bank_transfer`, depositedTotal,
        actionKey(auth.user.businessId, depositId, 'bank_transfer')],
    );
    await connection.commit();
    return NextResponse.json({ success: true, depositId, depositedTotal, bankVariance, replayed: false });
  } catch (error: any) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'This deposit confirmation is already being processed' }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId: auth.user.businessId,
      source: 'ims.cash_banking',
      operation: 'confirm-deposit',
      title: 'Cash deposit confirmation failed',
      error,
      context: { depositId },
    }).catch(() => {});
    return NextResponse.json({ error: error?.message ?? 'Cash deposit confirmation failed' }, { status: 500 });
  } finally {
    connection.release();
  }
}