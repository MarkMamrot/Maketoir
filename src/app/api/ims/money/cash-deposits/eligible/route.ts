import { NextResponse } from 'next/server';
import { buildCashDepositEligibility, CashEodPlanState, CashEodSource } from '@/lib/ims/cashDepositEligibility';
import { requirePosManagerTier } from '@/lib/sessionUtils';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import { xeroApiFetch } from '@/services/XeroService';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const auth = requirePosManagerTier();
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const locationId = Number(params.get('locationId'));
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  if (!Number.isInteger(locationId) || locationId <= 0 || !DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) {
    return NextResponse.json({ error: 'Valid locationId, from, and to are required' }, { status: 400 });
  }

  const locations = await imsQuery<{ id: number; name: string }>(
    'SELECT id, name FROM ims_locations WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1',
    [locationId, auth.user.businessId],
  );
  if (!locations.length) return NextResponse.json({ error: 'Location not found' }, { status: 404 });

  const sources = await imsQuery<CashEodSource>(
    `SELECT r.id, r.recon_date, r.register_id, r.register_session_id,
            pr.name AS register_name, r.expected_amount, r.counted_amount,
            r.opening_float, r.xero_invoice_id, r.xero_payment_id, r.xero_payment_required
       FROM pos_eod_reconciliations r
       LEFT JOIN pos_registers pr ON pr.id = r.register_id
      WHERE r.location_id = ?
        AND LOWER(TRIM(r.payment_method)) = 'cash'
        AND r.counted_amount IS NOT NULL
        AND r.recon_date BETWEEN ? AND ?
      ORDER BY r.recon_date, r.id`,
    [locationId, from, to],
  );
  const openSessions = await imsQuery<{ session_date: string | Date }>(
    `SELECT DISTINCT session_date FROM pos_register_sessions
      WHERE location_id = ? AND status = 'open' AND session_date BETWEEN ? AND ?`,
    [locationId, from, to],
  );
  const incompleteSessions = await imsQuery<{ session_date: string | Date }>(
    `SELECT DISTINCT s.session_date
       FROM pos_register_sessions s
       LEFT JOIN pos_eod_reconciliations r
         ON r.register_session_id = s.id
        AND LOWER(TRIM(r.payment_method)) = 'cash'
        AND r.counted_amount IS NOT NULL
      WHERE s.location_id = ? AND s.status = 'closed' AND s.session_date BETWEEN ? AND ?
        AND r.id IS NULL`,
    [locationId, from, to],
  );
  const sourceIds = sources.map(source => Number(source.id));
  const placeholders = sourceIds.map(() => '?').join(',');
  const plans = sourceIds.length ? await query<CashEodPlanState>(
    `SELECT eod_reconciliation_id, accounting_version, payment_status, variance_status, till_variance
       FROM xero_pos_cash_eod_actions
      WHERE business_id = ? AND eod_reconciliation_id IN (${placeholders})`,
    [auth.user.businessId, ...sourceIds],
  ) : [];
  const reserved = sourceIds.length ? await query<{ eod_reconciliation_id: number }>(
    `SELECT eod_reconciliation_id FROM xero_cash_deposit_sources
      WHERE business_id = ? AND eod_reconciliation_id IN (${placeholders})`,
    [auth.user.businessId, ...sourceIds],
  ) : [];
  const settings = await query<any>(
    `SELECT destination_account_id, destination_account_code, destination_account_name
       FROM xero_cash_deposit_settings
      WHERE business_id = ? AND ims_location_id = ? LIMIT 1`,
    [auth.user.businessId, locationId],
  );
  const cashMappings = await query<any>(
    `SELECT xero_account_id, xero_account_code, xero_account_name
       FROM xero_pos_clearing_mappings
      WHERE business_id = ? AND ims_location_id = ? AND LOWER(TRIM(payment_method)) = 'cash' LIMIT 1`,
    [auth.user.businessId, locationId],
  );
  let bankAccounts: Array<{ accountId: string; code: string; name: string }> = [];
  try {
    const accountResponse = await xeroApiFetch(auth.user.businessId, '/Accounts');
    bankAccounts = (accountResponse?.Accounts ?? [])
      .filter((account: any) => account.Type === 'BANK' && account.Status === 'ACTIVE')
      .map((account: any) => ({ accountId: String(account.AccountID), code: String(account.Code ?? ''), name: String(account.Name ?? '') }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  } catch {}

  const days = buildCashDepositEligibility({
    sources,
    plans,
    reservedSourceIds: new Set(reserved.map(row => Number(row.eod_reconciliation_id))),
    openDates: new Set(openSessions.map(row => row.session_date instanceof Date ? row.session_date.toISOString().slice(0, 10) : String(row.session_date).slice(0, 10))),
    incompleteDates: new Set(incompleteSessions.map(row => row.session_date instanceof Date ? row.session_date.toISOString().slice(0, 10) : String(row.session_date).slice(0, 10))),
  });
  return NextResponse.json({
    success: true,
    location: locations[0],
    cashClearingAccount: cashMappings[0] ?? null,
    defaultDestinationAccount: settings[0] ?? null,
    bankAccounts,
    days,
  });
}