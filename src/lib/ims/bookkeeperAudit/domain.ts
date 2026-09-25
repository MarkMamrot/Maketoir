import { createHash } from 'crypto';
import type { AuditCheckId } from './checks';

export const AUDIT_DUE_DATE_RULES = {
  purchase_order_active: 30,
  sales_order_active: 14,
  customer_credit_note_awaiting_product: 30,
  branch_transfer_active: 7,
  stocktake_in_progress: 2,
  purchase_order_draft: 60,
  sales_order_draft: 90,
  customer_credit_note_draft: 30,
  supplier_credit_note_draft: 30,
  branch_transfer_draft: 30,
} as const;

export type AuditDueDateRule = keyof typeof AUDIT_DUE_DATE_RULES;
export type AuditSeverity = 'critical' | 'error' | 'warning';
export type AuditCategory = 'accounting_xero' | 'sales_cogs' | 'stock' | 'orders_returns' | 'end_of_day';
export type AuditCoverage = 'checked' | 'unable_to_check';

export interface AuditDueDate {
  date: string;
  source: 'explicit' | 'assumed';
  assumedDays: number | null;
}

export interface AuditFinding {
  key: string;
  checkId: AuditCheckId;
  fingerprint: string;
  category: AuditCategory;
  severity: AuditSeverity;
  coverage: AuditCoverage;
  title: string;
  summary: string;
  sourceType: string;
  sourceId: string;
  sourceReference: string;
  sourceContext?: string | null;
  sourceHref: string | null;
  xeroHistoryHref?: string | null;
  xeroHref?: string | null;
  detail?: {
    localState: string;
    xeroState: string;
    explanation: string;
  } | null;
  occurredAt: string;
  detectedAt: string;
  dueDate: AuditDueDate | null;
  expected: string | number | null;
  actual: string | number | null;
  variance: number | null;
  valueAtRisk: number | null;
  recommendedAction: string;
}

export interface PresentedAuditFinding extends AuditFinding {
  reviewStatus: 'open' | 'accepted';
  review: {
    reason: string;
    actorName: string | null;
    acceptedAt: string;
  } | null;
}

function stableAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableAuditValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableAuditValue(child)]),
  );
}

export function fingerprintAuditEvidence(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableAuditValue(value))).digest('hex');
}

function parseDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid audit date: ${value}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (formatDateOnly(date) !== value) throw new Error(`Invalid audit date: ${value}`);
  return date;
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addAuditDays(value: string, days: number): string {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
}

export function resolveAuditDueDate(input: {
  explicitDate?: string | null;
  fallbackDate: string;
  rule: AuditDueDateRule;
}): AuditDueDate {
  if (input.explicitDate) {
    parseDateOnly(input.explicitDate);
    return { date: input.explicitDate, source: 'explicit', assumedDays: null };
  }
  const assumedDays = AUDIT_DUE_DATE_RULES[input.rule];
  return {
    date: addAuditDays(input.fallbackDate, assumedDays),
    source: 'assumed',
    assumedDays,
  };
}

export function isAuditOverdue(dueDate: AuditDueDate | null, asOfDate: string): boolean {
  if (!dueDate) return false;
  parseDateOnly(asOfDate);
  return dueDate.date < asOfDate;
}

export function compareAuditFindingsNewestFirst(left: AuditFinding, right: AuditFinding): number {
  return right.occurredAt.localeCompare(left.occurredAt)
    || right.detectedAt.localeCompare(left.detectedAt)
    || left.key.localeCompare(right.key);
}

export function previousCalendarMonth(asOfDate: string): { startDate: string; endDateExclusive: string; periodEnd: string } {
  const asOf = parseDateOnly(asOfDate);
  const start = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const periodEnd = new Date(end);
  periodEnd.setUTCDate(periodEnd.getUTCDate() - 1);
  return { startDate: formatDateOnly(start), endDateExclusive: formatDateOnly(end), periodEnd: formatDateOnly(periodEnd) };
}