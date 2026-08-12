import { calculateCashPosition } from '@/lib/ims/cashBankingMath';

export type CashEodSource = {
  id: number;
  recon_date: string | Date;
  register_id: number | null;
  register_session_id: number | null;
  register_name: string | null;
  expected_amount: number | string | null;
  counted_amount: number | string | null;
  opening_float: number | string | null;
  xero_invoice_id: string | null;
  xero_payment_id: string | null;
  xero_payment_required: number;
};

export type CashEodPlanState = {
  eod_reconciliation_id: number;
  accounting_version: number;
  payment_status: string;
  variance_status: string;
  petty_cash_status: string;
  till_variance: number | string;
};

function dateString(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function buildCashDepositEligibility(input: {
  sources: CashEodSource[];
  plans: CashEodPlanState[];
  reservedSourceIds: Set<number>;
  openDates: Set<string>;
  incompleteDates?: Set<string>;
}) {
  const plans = new Map(input.plans.map(plan => [Number(plan.eod_reconciliation_id), plan]));
  const grouped = new Map<string, CashEodSource[]>();
  for (const source of input.sources) {
    const date = dateString(source.recon_date);
    grouped.set(date, [...(grouped.get(date) ?? []), source]);
  }

  return Array.from(grouped.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([date, sources]) => {
    const blockers: string[] = [];
    if (input.openDates.has(date)) blockers.push('One or more register sessions are still open');
    if (input.incompleteDates?.has(date)) blockers.push('One or more closed register sessions have no counted Cash reconciliation');
    const rows = sources.map(source => {
      const expected = Number(source.expected_amount ?? 0);
      const counted = Number(source.counted_amount ?? 0);
      const openingFloat = Number(source.opening_float ?? 0);
      const position = calculateCashPosition({ expectedAmount: expected, countedAmount: counted, openingFloat });
      const plan = plans.get(Number(source.id));
      const reserved = input.reservedSourceIds.has(Number(source.id));
      const legacyPaid = !plan && (!!source.xero_payment_id || (!!source.xero_invoice_id && !source.xero_payment_required));
      const correctedReady = !!plan
        && ['completed', 'not_required'].includes(plan.payment_status)
        && ['completed', 'not_required'].includes(plan.variance_status)
        && ['completed', 'not_required'].includes(plan.petty_cash_status ?? 'not_required');
      if (reserved) blockers.push(`Register reconciliation ${source.id} is already reserved by a deposit`);
      if (!legacyPaid && !correctedReady) blockers.push(`Register reconciliation ${source.id} has incomplete Xero cash accounting`);
      return {
        id: Number(source.id),
        registerId: source.register_id,
        registerSessionId: source.register_session_id,
        registerName: source.register_name,
        expectedAmount: expected,
        countedAmount: counted,
        openingFloat,
        expectedCustody: position.drawerCashAvailable,
        tillVariance: plan ? Number(plan.till_variance) : position.tillVariance,
        accountingVersion: plan ? Number(plan.accounting_version) : 1,
        legacy: legacyPaid,
        reserved,
        xeroInvoiceId: source.xero_invoice_id,
        xeroPaymentId: source.xero_payment_id,
      };
    });
    const uniqueBlockers = Array.from(new Set(blockers));
    return {
      date,
      eligible: uniqueBlockers.length === 0,
      blockers: uniqueBlockers,
      expectedCustody: Math.round(rows.reduce((sum, row) => sum + row.expectedCustody, 0) * 100) / 100,
      tillVariance: Math.round(rows.reduce((sum, row) => sum + row.tillVariance, 0) * 100) / 100,
      legacy: rows.some(row => row.legacy),
      sources: rows,
    };
  });
}