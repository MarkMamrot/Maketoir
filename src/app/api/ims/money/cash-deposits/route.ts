import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildCashDepositEligibility, CashEodPlanState, CashEodSource } from '@/lib/ims/cashDepositEligibility';
import { requirePosManagerTier } from '@/lib/sessionUtils';
import { imsQuery } from '@/services/IMSMySQLService';
import { getPool, query } from '@/services/MySQLService';
import { xeroApiFetch } from '@/services/XeroService';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const money = (value: unknown) => Math.round(Number(value) * 100) / 100;
const actionKey = (businessId: string, depositId: number, type: string, date = '') =>
  crypto.createHash('sha256').update(`${businessId}:cash-deposit:${depositId}:${type}:${date}`).digest('hex');

async function loadSources(businessId: string, locationId: number, dates: string[]) {
  const placeholders = dates.map(() => '?').join(',');
  const sources = await imsQuery<CashEodSource>(
    `SELECT r.id, r.recon_date, r.register_id, r.register_session_id,
            pr.name AS register_name, r.expected_amount, r.counted_amount,
            r.opening_float, r.xero_invoice_id, r.xero_payment_id, r.xero_payment_required
       FROM pos_eod_reconciliations r
       LEFT JOIN pos_registers pr ON pr.id = r.register_id
      WHERE r.location_id = ?
        AND LOWER(TRIM(r.payment_method)) = 'cash' AND r.counted_amount IS NOT NULL
        AND r.recon_date IN (${placeholders})
      ORDER BY r.recon_date, r.id`,
    [locationId, ...dates],
  );
  const openSessions = await imsQuery<{ session_date: string | Date }>(
    `SELECT DISTINCT session_date FROM pos_register_sessions
      WHERE location_id = ? AND status = 'open' AND session_date IN (${placeholders})`,
    [locationId, ...dates],
  );
  const incompleteSessions = await imsQuery<{ session_date: string | Date }>(
    `SELECT DISTINCT s.session_date
       FROM pos_register_sessions s
       LEFT JOIN pos_eod_reconciliations r
         ON r.register_session_id = s.id
        AND LOWER(TRIM(r.payment_method)) = 'cash'
        AND r.counted_amount IS NOT NULL
      WHERE s.location_id = ? AND s.status = 'closed' AND s.session_date IN (${placeholders})
        AND r.id IS NULL`,
    [locationId, ...dates],
  );
  const ids = sources.map(source => Number(source.id));
  const idPlaceholders = ids.map(() => '?').join(',');
  const plans = ids.length ? await query<CashEodPlanState>(
    `SELECT eod_reconciliation_id, accounting_version, payment_status, variance_status, petty_cash_status, till_variance
       FROM xero_pos_cash_eod_actions WHERE business_id = ? AND eod_reconciliation_id IN (${idPlaceholders})`,
    [businessId, ...ids],
  ) : [];
  const reserved = ids.length ? await query<{ eod_reconciliation_id: number }>(
    `SELECT eod_reconciliation_id FROM xero_cash_deposit_sources
      WHERE business_id = ? AND eod_reconciliation_id IN (${idPlaceholders})`,
    [businessId, ...ids],
  ) : [];
  return buildCashDepositEligibility({
    sources,
    plans,
    reservedSourceIds: new Set(reserved.map(row => Number(row.eod_reconciliation_id))),
    openDates: new Set(openSessions.map(row => row.session_date instanceof Date ? row.session_date.toISOString().slice(0, 10) : String(row.session_date).slice(0, 10))),
    incompleteDates: new Set(incompleteSessions.map(row => row.session_date instanceof Date ? row.session_date.toISOString().slice(0, 10) : String(row.session_date).slice(0, 10))),
  });
}

export async function GET() {
  const auth = requirePosManagerTier();
  if (auth.response) return auth.response;
  const deposits = await query<any>(
    `SELECT id, ims_location_id, lodgement_date, bank_reference, source_account_name,
            destination_account_name, expected_total, counted_total, variance_total,
            status, prepared_by_name, posted_by_name, posted_at, error_detail, created_at
       FROM xero_cash_deposits WHERE business_id = ? ORDER BY created_at DESC LIMIT 100`,
    [auth.user.businessId],
  );
  return NextResponse.json({ success: true, canPost: ['Admin', 'SuperAdmin'].includes(auth.user.tier), deposits });
}

export async function POST(request: Request) {
  const auth = requirePosManagerTier();
  if (auth.response) return auth.response;
  const body = await request.json();
  const locationId = Number(body.locationId);
  const lodgementDate = typeof body.lodgementDate === 'string' ? body.lodgementDate : '';
  const selectedDays = Array.isArray(body.days) ? body.days : [];
  if (!Number.isInteger(locationId) || locationId <= 0 || !DATE_PATTERN.test(lodgementDate) || !selectedDays.length) {
    return NextResponse.json({ error: 'Location, lodgement date, and at least one day are required' }, { status: 400 });
  }
  const counts = new Map<string, number>();
  for (const day of selectedDays) {
    if (!DATE_PATTERN.test(day?.date) || !Number.isFinite(Number(day?.countedAmount)) || Number(day.countedAmount) < 0 || counts.has(day.date)) {
      return NextResponse.json({ error: 'Each selected day requires one valid non-negative counted amount' }, { status: 400 });
    }
    counts.set(day.date, money(day.countedAmount));
  }
  const dates = Array.from(counts.keys()).sort();
  const locations = await imsQuery<{ id: number }>('SELECT id FROM ims_locations WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1', [locationId, auth.user.businessId]);
  if (!locations.length) return NextResponse.json({ error: 'Location not found' }, { status: 404 });

  const eligibleDays = await loadSources(auth.user.businessId, locationId, dates);
  const selected = dates.map(date => eligibleDays.find(day => day.date === date));
  if (selected.some(day => !day || !day.eligible)) {
    return NextResponse.json({ error: 'One or more selected days are no longer eligible', days: selected }, { status: 409 });
  }
  const [clearing] = await query<any>(
    `SELECT xero_account_id, xero_account_code, xero_account_name FROM xero_pos_clearing_mappings
      WHERE business_id = ? AND ims_location_id = ? AND LOWER(TRIM(payment_method)) = 'cash' LIMIT 1`,
    [auth.user.businessId, locationId],
  );
  const [overShort] = await query<any>(
    `SELECT xero_account_id, xero_account_code, xero_account_name FROM xero_account_mappings
      WHERE business_id = ? AND role_key = 'cash_over_short' LIMIT 1`,
    [auth.user.businessId],
  );
  const [configuredDestination] = await query<any>(
    `SELECT destination_account_id, destination_account_code, destination_account_name FROM xero_cash_deposit_settings
      WHERE business_id = ? AND ims_location_id = ? LIMIT 1`,
    [auth.user.businessId, locationId],
  );
  if (!clearing) return NextResponse.json({ error: 'Cash clearing account is not configured for this location' }, { status: 409 });
  const hasVariance = selected.some(day => money((counts.get(day!.date) ?? 0) - day!.expectedCustody) !== 0);
  if (hasVariance && !overShort) return NextResponse.json({ error: 'Cash Over / Short account is not configured' }, { status: 409 });

  const overrideId = typeof body.destinationAccountId === 'string' ? body.destinationAccountId.trim() : '';
  let destination = configuredDestination;
  if (overrideId && overrideId !== configuredDestination?.destination_account_id) {
    const response = await xeroApiFetch(auth.user.businessId, `/Accounts/${encodeURIComponent(overrideId)}`);
    const account = (response?.Accounts ?? []).find((candidate: any) => candidate.AccountID === overrideId);
    if (!account || account.Status !== 'ACTIVE' || account.Type !== 'BANK') {
      return NextResponse.json({ error: 'Select an active Xero bank account' }, { status: 400 });
    }
    destination = { destination_account_id: account.AccountID, destination_account_code: String(account.Code ?? ''), destination_account_name: account.Name ?? '' };
  }
  if (!destination) return NextResponse.json({ error: 'A destination bank account is required' }, { status: 409 });

  const expectedTotal = money(selected.reduce((sum, day) => sum + day!.expectedCustody, 0));
  const countedTotal = money(Array.from(counts.values()).reduce((sum, amount) => sum + amount, 0));
  const varianceTotal = money(countedTotal - expectedTotal);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [headerResult]: any = await connection.execute(
      `INSERT INTO xero_cash_deposits
       (business_id, ims_location_id, lodgement_date, bank_reference, notes,
        source_account_id, source_account_code, source_account_name,
        over_short_account_id, over_short_account_code, over_short_account_name,
        destination_account_id, destination_account_code, destination_account_name,
        expected_total, counted_total, variance_total, status, prepared_by_user_id, prepared_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [auth.user.businessId, locationId, lodgementDate, String(body.bankReference ?? '').trim() || null,
        String(body.notes ?? '').trim() || null, clearing.xero_account_id, clearing.xero_account_code,
        clearing.xero_account_name, overShort?.xero_account_id ?? null, overShort?.xero_account_code ?? null,
        overShort?.xero_account_name ?? null, destination.destination_account_id, destination.destination_account_code,
        destination.destination_account_name, expectedTotal, countedTotal, varianceTotal, auth.user.userId, auth.user.name],
    );
    const depositId = Number(headerResult.insertId);
    for (const day of selected) {
      const counted = counts.get(day!.date)!;
      const variance = money(counted - day!.expectedCustody);
      const [dayResult]: any = await connection.execute(
        `INSERT INTO xero_cash_deposit_days
         (cash_deposit_id, business_id, business_date, expected_custody, counted_deposit, banking_variance)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [depositId, auth.user.businessId, day!.date, day!.expectedCustody, counted, variance],
      );
      for (const source of day!.sources) {
        await connection.execute(
          `INSERT INTO xero_cash_deposit_sources
           (cash_deposit_id, cash_deposit_day_id, business_id, eod_reconciliation_id,
            expected_amount, counted_amount, opening_float, expected_custody, till_variance,
            accounting_version, xero_invoice_id, xero_payment_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [depositId, dayResult.insertId, auth.user.businessId, source.id, source.expectedAmount,
            source.countedAmount, source.openingFloat, source.expectedCustody, source.tillVariance,
            source.accountingVersion, source.xeroInvoiceId ?? null, source.xeroPaymentId ?? null],
        );
      }
      if (variance !== 0) {
        const key = actionKey(auth.user.businessId, depositId, 'variance', day!.date);
        await connection.execute(
          `INSERT INTO xero_cash_deposit_actions
           (cash_deposit_id, business_id, action_key, action_type, business_date, amount, idempotency_key)
           VALUES (?, ?, ?, 'variance', ?, ?, ?)`,
          [depositId, auth.user.businessId, `${depositId}:variance:${day!.date}`, day!.date, variance, key],
        );
      }
    }
    const transferKey = actionKey(auth.user.businessId, depositId, 'bank_transfer');
    await connection.execute(
      `INSERT INTO xero_cash_deposit_actions
       (cash_deposit_id, business_id, action_key, action_type, amount, idempotency_key)
        VALUES (?, ?, ?, 'bank_transfer', ?, ?)`,
      [depositId, auth.user.businessId, `${depositId}:bank_transfer`, countedTotal, transferKey],
    );
    await connection.commit();
    return NextResponse.json({ success: true, depositId, expectedTotal, countedTotal, varianceTotal }, { status: 201 });
  } catch (error: any) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') return NextResponse.json({ error: 'A selected day is already reserved by another deposit' }, { status: 409 });
    throw error;
  } finally {
    connection.release();
  }
}