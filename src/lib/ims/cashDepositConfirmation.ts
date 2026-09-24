export type CashPreparationVariance = {
  businessDate: string;
  amount: number;
};

export type CashDepositAccountingMethod = 'solvantis' | 'recorded_externally';

export function localDateInTimeZone(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validateCashDepositConfirmation(input: {
  accountingMethod: CashDepositAccountingMethod;
  lodgementDate: string;
  today: string;
  bankReference: string;
  notes: string;
}): string | null {
  const parsedDate = new Date(`${input.lodgementDate}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== input.lodgementDate) {
    return 'Enter a valid lodgement date';
  }
  if (input.lodgementDate > input.today) return 'Lodgement date cannot be in the future';
  const requiresEvidence = input.lodgementDate < input.today || input.accountingMethod === 'recorded_externally';
  if (requiresEvidence && !input.bankReference.trim()) {
    return 'A bank reference is required for backdated or externally recorded deposits';
  }
  if (requiresEvidence && !input.notes.trim()) {
    return 'An explanation is required for backdated or externally recorded deposits';
  }
  return null;
}

const money = (value: unknown) => Math.round(Number(value) * 100) / 100;

export function buildCashDepositConfirmationPlan(input: {
  preparedTotal: number | string;
  depositedTotal: number | string;
  days: Array<{ business_date: string | Date; banking_variance: number | string }>;
}) {
  const preparationVariances: CashPreparationVariance[] = input.days
    .map(day => ({
      businessDate: day.business_date instanceof Date
        ? day.business_date.toISOString().slice(0, 10)
        : String(day.business_date).slice(0, 10),
      amount: money(day.banking_variance),
    }))
    .filter(day => day.amount !== 0);
  return {
    preparationVariances,
    bankAcceptanceVariance: money(Number(input.depositedTotal) - Number(input.preparedTotal)),
  };
}