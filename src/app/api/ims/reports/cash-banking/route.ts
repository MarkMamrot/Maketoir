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
  if (status) { statusClause = ' AND d.status = ?'; values.push(status); }
  const deposits = await query<any>(
    `SELECT d.id, d.ims_location_id, d.lodgement_date, d.bank_reference, d.source_account_name,
            d.destination_account_name, d.expected_total, d.counted_total, d.variance_total,
            d.deposited_total, d.bank_variance_total, d.confirmation_status,
            d.status, d.prepared_by_name, d.confirmed_by_name, d.confirmed_at,
            d.posted_by_name, d.posted_at, d.xero_bank_transfer_id,
            d.error_detail, d.external_correction_note, d.external_correction_ref, d.external_correction_date, d.created_at,
            COALESCE((SELECT SUM(s.till_variance) FROM xero_cash_deposit_sources s
                       WHERE s.business_id = d.business_id AND s.cash_deposit_id = d.id), 0) AS store_till_variance_total
       FROM xero_cash_deposits d
      WHERE d.business_id = ? AND COALESCE(d.lodgement_date, DATE(d.created_at)) BETWEEN ? AND ?${statusClause}
      ORDER BY COALESCE(d.lodgement_date, DATE(d.created_at)) DESC, d.id DESC`,
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