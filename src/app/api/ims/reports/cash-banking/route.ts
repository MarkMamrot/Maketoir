import { NextResponse } from 'next/server';
import { requirePosManagerTier } from '@/lib/sessionUtils';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const auth = requirePosManagerTier();
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const status = params.get('status')?.trim() ?? '';
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) {
    return NextResponse.json({ error: 'Valid from and to dates are required' }, { status: 400 });
  }
  const values: any[] = [auth.user.businessId, from, to];
  let statusClause = '';
  if (status) { statusClause = ' AND status = ?'; values.push(status); }
  const deposits = await query<any>(
    `SELECT id, ims_location_id, lodgement_date, bank_reference, source_account_name,
            destination_account_name, expected_total, counted_total, variance_total,
            status, prepared_by_name, posted_by_name, posted_at, xero_bank_transfer_id,
            error_detail, external_correction_note, external_correction_ref, external_correction_date, created_at
       FROM xero_cash_deposits
      WHERE business_id = ? AND lodgement_date BETWEEN ? AND ?${statusClause}
      ORDER BY lodgement_date DESC, id DESC`,
    values,
  );
  const locations = await imsQuery<{ id: number; name: string }>(
    'SELECT id, name FROM ims_locations WHERE business_id = ? ORDER BY name',
    [auth.user.businessId],
  );
  const names = new Map(locations.map(location => [Number(location.id), location.name]));
  return NextResponse.json({
    success: true,
    canRecordCorrection: ['Admin', 'SuperAdmin'].includes(auth.user.tier),
    deposits: deposits.map(deposit => ({ ...deposit, location_name: names.get(Number(deposit.ims_location_id)) ?? `Location ${deposit.ims_location_id}` })),
  });
}