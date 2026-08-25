import type {
  DaybookDiscrepancyStatus,
  DaybookNeedStatus,
  DaybookRequestStatus,
  DaybookStaffIdentity,
  DaybookTaskRecurrence,
} from './daybookTypes';

export const NEWTOWN_COMMUNICATIONS_START_DATE = '2026-01-01';

const REQUEST_TRANSITIONS: Record<DaybookRequestStatus, readonly DaybookRequestStatus[]> = {
  open: ['contacted', 'fulfilled', 'cancelled'],
  contacted: ['open', 'fulfilled', 'cancelled'],
  fulfilled: [],
  cancelled: [],
};

const NEED_TRANSITIONS: Record<DaybookNeedStatus, readonly DaybookNeedStatus[]> = {
  requested: ['approved', 'cancelled'],
  approved: ['packed', 'cancelled'],
  packed: ['sent', 'cancelled'],
  sent: ['received'],
  received: [],
  cancelled: [],
};

const DISCREPANCY_TRANSITIONS: Record<DaybookDiscrepancyStatus, readonly DaybookDiscrepancyStatus[]> = {
  open: ['stocktake_planned', 'adjusted', 'no_change', 'closed'],
  stocktake_planned: ['adjusted', 'no_change', 'closed'],
  adjusted: ['closed'],
  no_change: ['closed'],
  closed: [],
};

export function normalizeStaffIdentity(identity: DaybookStaffIdentity): DaybookStaffIdentity {
  const name = identity.name.trim().replace(/\s+/g, ' ').slice(0, 120);
  const enteredInitials = identity.initials.trim().replace(/[^a-z0-9]/gi, '').toUpperCase();
  const derivedInitials = name.split(' ').filter(Boolean).slice(0, 3).map(part => part[0]).join('').toUpperCase();
  const initials = (enteredInitials || derivedInitials).slice(0, 8);
  if (!name || !initials) throw new Error('Staff name and initials are required.');
  return { id: identity.id ?? null, name, initials };
}

export function parseDaybookDate(value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned);
  const local = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(cleaned);
  const year = iso ? Number(iso[1]) : local ? Number(local[3].length === 2 ? `20${local[3]}` : local[3]) : 0;
  const month = iso ? Number(iso[2]) : local ? Number(local[2]) : 0;
  const day = iso ? Number(iso[3]) : local ? Number(local[1]) : 0;
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

export function shouldImportNewtownCommunication(value: string): boolean {
  const date = parseDaybookDate(value);
  return date !== null && date >= NEWTOWN_COMMUNICATIONS_START_DATE;
}

export function calculateStockVariance(systemQuantity: number, physicalQuantity: number): number {
  if (!Number.isFinite(systemQuantity) || !Number.isFinite(physicalQuantity)) {
    throw new Error('Stock quantities must be finite numbers.');
  }
  return physicalQuantity - systemQuantity;
}

export function taskOccursOnDate(task: DaybookTaskRecurrence, isoDate: string): boolean {
  const date = parseDaybookDate(isoDate);
  if (!date || (task.effectiveFrom && date < task.effectiveFrom) || (task.effectiveTo && date > task.effectiveTo)) return false;
  if (task.recurrence === 'once') return date === task.scheduledDate;
  if (task.recurrence === 'daily') return true;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === task.weekday;
}

export function canTransitionRequest(from: DaybookRequestStatus, to: DaybookRequestStatus): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

export function canTransitionNeed(from: DaybookNeedStatus, to: DaybookNeedStatus): boolean {
  return NEED_TRANSITIONS[from].includes(to);
}

export function canTransitionDiscrepancy(from: DaybookDiscrepancyStatus, to: DaybookDiscrepancyStatus): boolean {
  return DISCREPANCY_TRANSITIONS[from].includes(to);
}