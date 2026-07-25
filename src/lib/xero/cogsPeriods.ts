export type CogsFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';

export interface CogsPeriod {
  frequency: CogsFrequency;
  startDate: string;
  endDateExclusive: string;
  journalDate: string;
  key: string;
  label: string;
}

export interface CogsJournalLine {
  AccountCode: string;
  Description: string;
  TaxType: 'NONE';
  DebitAmount?: number;
  CreditAmount?: number;
}

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string): Date {
  if (!DATE_FORMAT.test(value)) throw new Error(`Invalid calendar date: ${value}`);
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function localDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function shiftMonths(value: string, months: number): string {
  const date = parseDate(monthStart(value));
  date.setUTCMonth(date.getUTCMonth() + months);
  return formatDate(date);
}

function periodLabel(frequency: CogsFrequency, startDate: string, journalDate: string): string {
  const start = parseDate(startDate);
  if (frequency === 'daily') {
    return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeZone: 'UTC' }).format(start);
  }
  if (frequency === 'monthly') {
    return new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start);
  }
  if (frequency === 'quarterly') {
    return `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}`;
  }
  return `${startDate} to ${journalDate}`;
}

export function getMonthlyCogsPeriod(month: string): CogsPeriod {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Month must use YYYY-MM format.');
  }
  const startDate = `${month}-01`;
  const endDateExclusive = shiftMonths(startDate, 1);
  const journalDate = addDays(endDateExclusive, -1);
  return {
    frequency: 'monthly',
    startDate,
    endDateExclusive,
    journalDate,
    key: `monthly:${startDate}:${endDateExclusive}`,
    label: periodLabel('monthly', startDate, journalDate),
  };
}

export function getCogsPeriodStartingAt(frequency: CogsFrequency, startDate: string): CogsPeriod {
  parseDate(startDate);
  let endDateExclusive: string;
  if (frequency === 'daily') endDateExclusive = addDays(startDate, 1);
  else if (frequency === 'weekly') endDateExclusive = addDays(startDate, 7);
  else if (frequency === 'monthly') endDateExclusive = shiftMonths(startDate, 1);
  else endDateExclusive = shiftMonths(startDate, 3);

  const journalDate = addDays(endDateExclusive, -1);
  return {
    frequency,
    startDate,
    endDateExclusive,
    journalDate,
    key: `${frequency}:${startDate}:${endDateExclusive}`,
    label: periodLabel(frequency, startDate, journalDate),
  };
}

export function getLastCompletedCogsPeriod(
  frequency: CogsFrequency,
  now: Date = new Date(),
  timeZone = 'Australia/Sydney',
): CogsPeriod {
  const today = localDate(now, timeZone);
  let startDate: string;
  let endDateExclusive: string;

  if (frequency === 'daily') {
    endDateExclusive = today;
    startDate = addDays(today, -1);
  } else if (frequency === 'weekly') {
    const current = parseDate(today);
    const daysSinceMonday = (current.getUTCDay() + 6) % 7;
    endDateExclusive = addDays(today, -daysSinceMonday);
    startDate = addDays(endDateExclusive, -7);
  } else if (frequency === 'monthly') {
    endDateExclusive = monthStart(today);
    startDate = shiftMonths(endDateExclusive, -1);
  } else {
    const current = parseDate(today);
    const quarterMonth = Math.floor(current.getUTCMonth() / 3) * 3;
    endDateExclusive = formatDate(new Date(Date.UTC(current.getUTCFullYear(), quarterMonth, 1)));
    startDate = shiftMonths(endDateExclusive, -3);
  }

  const journalDate = addDays(endDateExclusive, -1);
  return {
    frequency,
    startDate,
    endDateExclusive,
    journalDate,
    key: `${frequency}:${startDate}:${endDateExclusive}`,
    label: periodLabel(frequency, startDate, journalDate),
  };
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildCogsJournalLines(input: {
  amount: number;
  cogsAccountCode: string;
  inventoryAccountCode: string;
  description: string;
}): CogsJournalLine[] {
  const amount = roundCurrency(input.amount);
  if (!Number.isFinite(amount) || amount === 0) return [];

  const absoluteAmount = Math.abs(amount);
  const cogsLine: CogsJournalLine = {
    AccountCode: input.cogsAccountCode,
    Description: input.description,
    TaxType: 'NONE',
  };
  const inventoryLine: CogsJournalLine = {
    AccountCode: input.inventoryAccountCode,
    Description: input.description,
    TaxType: 'NONE',
  };

  if (amount > 0) {
    cogsLine.DebitAmount = absoluteAmount;
    inventoryLine.CreditAmount = absoluteAmount;
  } else {
    inventoryLine.DebitAmount = absoluteAmount;
    cogsLine.CreditAmount = absoluteAmount;
  }

  return [cogsLine, inventoryLine];
}