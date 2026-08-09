import { createHash } from 'crypto';

export type ReconciliationSeverity = 'warning' | 'error' | 'critical';

export interface ReconciliationDocumentSnapshot {
  xeroId: string | null;
  documentType: string | null;
  contactId: string | null;
  currencyCode: string | null;
  total: number | null;
  status: string | null;
  compatibleStatuses: string[] | null;
  amountDue: number | null;
  amountPaid: number | null;
  amountCredited: number | null;
  remainingCredit: number | null;
}

export interface ReconciliationMismatch {
  ruleKey: 'missing_document' | 'linked_document' | 'document_type' | 'total' | 'currency' | 'contact' | 'lifecycle_state' | 'amount_due' | 'amount_paid' | 'amount_credited' | 'remaining_credit';
  severity: ReconciliationSeverity;
  summary: string;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  fingerprint: string;
}

function nullableText(value: unknown, uppercase = false): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return uppercase ? text.toUpperCase() : text;
}

function nullableMoney(value: unknown): number | null {
  if (value == null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

export function fingerprintReconciliationValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

export function canonicalDocumentSnapshot(input: Partial<ReconciliationDocumentSnapshot>): ReconciliationDocumentSnapshot {
  return {
    xeroId: nullableText(input.xeroId),
    documentType: nullableText(input.documentType, true),
    contactId: nullableText(input.contactId),
    currencyCode: nullableText(input.currencyCode, true),
    total: nullableMoney(input.total),
    status: nullableText(input.status, true),
    compatibleStatuses: Array.isArray(input.compatibleStatuses)
      ? [...new Set(input.compatibleStatuses.map(status => nullableText(status, true)).filter((status): status is string => !!status))].sort()
      : null,
    amountDue: nullableMoney(input.amountDue),
    amountPaid: nullableMoney(input.amountPaid),
    amountCredited: nullableMoney(input.amountCredited),
    remainingCredit: nullableMoney(input.remainingCredit),
  };
}

function mismatch(
  ruleKey: ReconciliationMismatch['ruleKey'],
  severity: ReconciliationSeverity,
  summary: string,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): ReconciliationMismatch {
  return {
    ruleKey,
    severity,
    summary,
    expected,
    actual,
    fingerprint: fingerprintReconciliationValue({ ruleKey, expected, actual }),
  };
}

function moneyDiffers(expected: number | null, actual: number | null): boolean {
  return expected != null
    && (actual == null || Math.abs(Math.round(expected * 100) - Math.round(actual * 100)) > 1);
}

export function compareDocumentSnapshots(
  expectedInput: ReconciliationDocumentSnapshot,
  actualInput: ReconciliationDocumentSnapshot | null,
): ReconciliationMismatch[] {
  const expected = canonicalDocumentSnapshot(expectedInput);
  const actual = actualInput ? canonicalDocumentSnapshot(actualInput) : null;
  if (expected.xeroId && !actual) {
    return [mismatch('missing_document', 'error', 'The linked document was not returned by Xero.',
      { xeroId: expected.xeroId }, { found: false })];
  }
  if (!actual) return [];

  const issues: ReconciliationMismatch[] = [];
  if (expected.xeroId && expected.xeroId !== actual.xeroId) {
    issues.push(mismatch('linked_document', 'critical', 'The live Xero document does not match the stored link.',
      { xeroId: expected.xeroId }, { xeroId: actual.xeroId }));
  }
  if (expected.documentType && expected.documentType !== actual.documentType) {
    issues.push(mismatch('document_type', 'critical', 'The linked Xero document has an incompatible type.',
      { documentType: expected.documentType }, { documentType: actual.documentType }));
  }
  if (moneyDiffers(expected.total, actual.total)) {
    issues.push(mismatch('total', 'error', 'The local and Xero document totals differ.',
      { total: expected.total }, { total: actual.total }));
  }
  if (expected.currencyCode && expected.currencyCode !== actual.currencyCode) {
    issues.push(mismatch('currency', 'error', 'The local and Xero document currencies differ.',
      { currencyCode: expected.currencyCode }, { currencyCode: actual.currencyCode }));
  }
  if (expected.contactId && expected.contactId !== actual.contactId) {
    issues.push(mismatch('contact', 'warning', 'The linked Xero document belongs to a different contact.',
      { contactId: expected.contactId }, { contactId: actual.contactId }));
  }
  if (expected.compatibleStatuses?.length && (!actual.status || !expected.compatibleStatuses.includes(actual.status))) {
    issues.push(mismatch('lifecycle_state', 'error', 'The Xero document status is incompatible with the local lifecycle.',
      { compatibleStatuses: expected.compatibleStatuses }, { status: actual.status }));
  }

  const balances: Array<{
    ruleKey: 'amount_due' | 'amount_paid' | 'amount_credited' | 'remaining_credit';
    label: string;
    expected: number | null;
    actual: number | null;
  }> = [
    { ruleKey: 'amount_due', label: 'amount due', expected: expected.amountDue, actual: actual.amountDue },
    { ruleKey: 'amount_paid', label: 'amount paid', expected: expected.amountPaid, actual: actual.amountPaid },
    { ruleKey: 'amount_credited', label: 'amount credited', expected: expected.amountCredited, actual: actual.amountCredited },
    { ruleKey: 'remaining_credit', label: 'remaining credit', expected: expected.remainingCredit, actual: actual.remainingCredit },
  ];
  for (const balance of balances) {
    if (moneyDiffers(balance.expected, balance.actual)) {
      issues.push(mismatch(balance.ruleKey, 'error', `The local and Xero ${balance.label} differ.`,
        { [balance.label]: balance.expected }, { [balance.label]: balance.actual }));
    }
  }
  return issues;
}