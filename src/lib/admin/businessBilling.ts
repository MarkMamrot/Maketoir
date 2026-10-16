export interface BusinessBillingEntry {
  month: string;
  paymentPlan: string;
  amountAud: string;
  paid: boolean;
  revision: number;
}

export interface BusinessBillingData {
  planStartDate: string | null;
  entries: BusinessBillingEntry[];
}

export class BusinessBillingValidationError extends Error {}

export function currentBillingMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit',
  }).formatToParts(now);
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}`;
}

export function validatePlanStartDate(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new BusinessBillingValidationError('Enter a valid plan start date.');
  }
  return value;
}

export function billingAmountCents(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{1,9}(?:\.\d{1,2})?$/.test(value.trim())) {
    throw new BusinessBillingValidationError('Enter an AUD amount from 0 to 999999999.99 with no more than two decimal places.');
  }
  const [whole, fraction = ''] = value.trim().split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function billingAmountAud(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function validateBillingEntries(value: unknown, now = new Date()): BusinessBillingEntry[] {
  if (!Array.isArray(value) || value.length > 1200) {
    throw new BusinessBillingValidationError('Submit no more than 1,200 monthly records at once.');
  }
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('month' in entry)
      || typeof entry.month !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(entry.month)
      || entry.month > currentBillingMonth(now) || seen.has(entry.month)) {
      throw new BusinessBillingValidationError('Each monthly record must have a unique, valid month that is not in the future.');
    }
    seen.add(entry.month);
    if (!('paymentPlan' in entry) || typeof entry.paymentPlan !== 'string'
      || !entry.paymentPlan.trim() || entry.paymentPlan.trim().length > 120) {
      throw new BusinessBillingValidationError(`${entry.month}: enter a payment plan of up to 120 characters.`);
    }
    if (!('paid' in entry) || typeof entry.paid !== 'boolean'
      || !('revision' in entry) || typeof entry.revision !== 'number'
      || !Number.isSafeInteger(entry.revision) || entry.revision < 0) {
      throw new BusinessBillingValidationError(`${entry.month}: invalid paid status or record revision.`);
    }
    const amount = billingAmountCents('amountAud' in entry ? entry.amountAud : undefined);
    return {
      month: entry.month, paymentPlan: entry.paymentPlan.trim(),
      amountAud: billingAmountAud(amount), paid: entry.paid, revision: entry.revision,
    };
  });
}

export function businessBillingMonths(startDate: string | null, entries: BusinessBillingEntry[], now = new Date()): string[] {
  const months = new Set(entries.map(entry => entry.month));
  const current = currentBillingMonth(now);
  if (startDate) {
    const start = startDate.slice(0, 7);
    for (let year = Number(start.slice(0, 4)); year <= Number(current.slice(0, 4)); year++) {
      for (let month = 1; month <= 12; month++) {
        const key = `${year}-${String(month).padStart(2, '0')}`;
        if (key >= start && key <= current) months.add(key);
      }
    }
  }
  return [...months].sort();
}
