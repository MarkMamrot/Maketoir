import { NextResponse } from 'next/server';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requirePosManagerTier } from '@/lib/sessionUtils';
import { execute, query } from '@/services/MySQLService';
import { xeroApiFetch } from '@/services/XeroService';

type CashDepositXeroLink = {
  id: number;
  xero_bank_transfer_id: string | null;
  xero_bank_transaction_id: string | null;
};

const xeroBankTransactionUrl = (bankTransactionId: string) =>
  `https://go.xero.com/Bank/ViewTransaction.aspx?bankTransactionID=${encodeURIComponent(bankTransactionId)}`;

export async function GET(_request: Request, { params }: { params: { depositId: string } }) {
  const auth = requirePosManagerTier();
  if (auth.response) return auth.response;
  const depositId = Number(params.depositId);
  if (!Number.isInteger(depositId) || depositId <= 0) {
    return NextResponse.json({ error: 'Invalid deposit ID' }, { status: 400 });
  }

  const [deposit] = await query<CashDepositXeroLink>(
    `SELECT id, xero_bank_transfer_id, xero_bank_transaction_id
       FROM xero_cash_deposits
      WHERE business_id = ? AND id = ? LIMIT 1`,
    [auth.user.businessId, depositId],
  );
  if (!deposit) return NextResponse.json({ error: 'Cash deposit not found' }, { status: 404 });
  if (deposit.xero_bank_transaction_id) {
    return NextResponse.redirect(xeroBankTransactionUrl(deposit.xero_bank_transaction_id));
  }
  if (!deposit.xero_bank_transfer_id) {
    return NextResponse.json({ error: 'Cash deposit has not been transferred to Xero' }, { status: 409 });
  }

  try {
    const response = await xeroApiFetch(
      auth.user.businessId,
      `/BankTransfers/${encodeURIComponent(deposit.xero_bank_transfer_id)}`,
    );
    const bankTransactionId = response?.BankTransfers?.[0]?.ToBankTransactionID;
    if (!bankTransactionId) throw new Error('Xero did not return the destination bank transaction ID');
    await execute(
      `UPDATE xero_cash_deposits SET xero_bank_transaction_id = ?
        WHERE business_id = ? AND id = ? AND xero_bank_transaction_id IS NULL`,
      [String(bankTransactionId), auth.user.businessId, depositId],
    );
    return NextResponse.redirect(xeroBankTransactionUrl(String(bankTransactionId)));
  } catch (error) {
    await reportRuntimeIssue({
      businessId: auth.user.businessId,
      source: 'ims.cash_banking',
      operation: 'open-xero-transfer',
      title: 'Cash deposit Xero transfer lookup failed',
      error,
      context: { depositId },
      reference: { type: 'cash_deposit', id: depositId },
    }).catch(() => {});
    return NextResponse.json({ error: 'Could not open this cash deposit in Xero' }, { status: 502 });
  }
}