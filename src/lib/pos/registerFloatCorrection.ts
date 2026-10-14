export function parseOpeningFloat(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount <= 9999999999.99 ? amount : null;
}

export type CashFloatSnapshot = {
  id: number;
  expected: number | null;
  counted: number | null;
  previousFloat: number | null;
  previousVariance: number | null;
  variance: number | null;
  xeroInvoiceId: string | null;
};

export function cashFloatSnapshot(row: {
  id: number; expected_amount: string | number | null;
  counted_amount: string | number | null; opening_float: string | number | null;
  xero_invoice_id: string | null;
}, openingFloat: number): CashFloatSnapshot {
  const expected = row.expected_amount == null ? null : Number(row.expected_amount);
  const counted = row.counted_amount == null ? null : Number(row.counted_amount);
  const previousFloat = row.opening_float == null ? null : Number(row.opening_float);
  const variance = (float: number) => counted == null || expected == null
    ? null : Math.round((counted - float - expected) * 100) / 100;
  return {
    id: row.id, expected, counted, previousFloat,
    previousVariance: variance(previousFloat ?? 0), variance: variance(openingFloat),
    xeroInvoiceId: row.xero_invoice_id,
  };
}

export function renderFloatCorrectionEmail(input: {
  id: number; register_name: string; location_name: string; session_date: string;
  previous_float: string | number | null; opening_float: string | number;
  actor_name: string; reason: string; created_at: string; cash: CashFloatSnapshot[];
}): { subject: string; html: string } {
  const escape = (value: string) => value.replace(/[&<>'"]/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
  const money = (value: string | number | null) => value == null ? 'Not recorded'
    : Number(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
  const text = [
    'Closed register opening float corrected',
    `Correction #${input.id}: ${input.location_name} / ${input.register_name}`,
    `Session date: ${input.session_date}`,
    `Opening float: ${money(input.previous_float)} -> ${money(input.opening_float)}`,
    `Corrected by ${input.actor_name} at ${input.created_at} (UTC).`,
    `Reason: ${input.reason}`,
    ...input.cash.map(row => `Cash reconciliation #${row.id}: expected ${money(row.expected)}, counted ${money(row.counted)}, variance ${money(row.previousVariance)} -> ${money(row.variance)}. Xero invoice: ${row.xeroInvoiceId ?? 'None recorded'}.`),
    'Solvantis cash variance has been recalculated. Counted cash, sales and existing accounting sync records have not been changed.',
    'The bookkeeper must review and manually correct any affected documents, payments, cash clearing and till over/short entries already synced to Xero or other accounting software. This email does not perform or retry an accounting sync.',
  ];
  return {
    subject: `Register opening float correction: ${input.location_name} / ${input.register_name} (${input.session_date})`,
    html: text.map(line => `<p>${escape(line)}</p>`).join(''),
  };
}
