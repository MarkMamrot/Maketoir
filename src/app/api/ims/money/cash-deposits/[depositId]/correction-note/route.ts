import { NextResponse } from 'next/server';
import { requireAdminTier } from '@/lib/sessionUtils';
import { execute, query } from '@/services/MySQLService';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request, { params }: { params: { depositId: string } }) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const depositId = Number(params.depositId);
  const body = await request.json();
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
  const correctionDate = typeof body.correctionDate === 'string' ? body.correctionDate : '';
  if (!Number.isInteger(depositId) || depositId <= 0 || !note || !DATE_PATTERN.test(correctionDate)) {
    return NextResponse.json({ error: 'A valid deposit, correction date, and note are required' }, { status: 400 });
  }
  const [deposit] = await query<{ status: string }>(
    'SELECT status FROM xero_cash_deposits WHERE business_id = ? AND id = ? LIMIT 1',
    [auth.user.businessId, depositId],
  );
  if (!deposit) return NextResponse.json({ error: 'Cash deposit not found' }, { status: 404 });
  if (deposit.status !== 'posted') return NextResponse.json({ error: 'Correction notes can only be recorded against posted deposits' }, { status: 409 });
  await execute(
    `UPDATE xero_cash_deposits
        SET external_correction_note = ?, external_correction_ref = ?, external_correction_date = ?
      WHERE business_id = ? AND id = ?`,
    [note, reference || null, correctionDate, auth.user.businessId, depositId],
  );
  return NextResponse.json({ success: true });
}