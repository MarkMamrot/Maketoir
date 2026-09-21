import type {
  DaybookDiscrepancyStatus,
  DaybookNeedStatus,
  DaybookRequestStatus,
  DaybookStaffIdentity,
  DaybookTaskRecurrence,
  DaybookColourKey,
  DaybookEditPolicy,
  DaybookTheme,
} from './daybookTypes';
import { DAYBOOK_COLOUR_KEYS, DAYBOOK_EDIT_POLICIES, DAYBOOK_THEMES } from './daybookTypes';
import sanitizeHtml from 'sanitize-html';

export const NEWTOWN_COMMUNICATIONS_START_DATE = '2026-01-01';

export function resolveDaybookLocationId(sessionLocationId: number, requestedLocationId: number): number | null {
  const sessionId = Number(sessionLocationId);
  const requestedId = Number(requestedLocationId);
  if (sessionId > 0 && requestedId > 0 && sessionId !== requestedId) return null;
  const locationId = sessionId > 0 ? sessionId : requestedId;
  return Number.isInteger(locationId) && locationId > 0 ? locationId : null;
}

const REQUEST_TRANSITIONS: Record<DaybookRequestStatus, readonly DaybookRequestStatus[]> = {
  open: ['contacted', 'fulfilled', 'cancelled'],
  contacted: ['open', 'fulfilled', 'cancelled'],
  fulfilled: [],
  cancelled: [],
};

const NEED_TRANSITIONS: Record<DaybookNeedStatus, readonly DaybookNeedStatus[]> = {
  requested: ['approved', 'packed', 'sent', 'received', 'cancelled'],
  approved: ['packed', 'sent', 'received', 'cancelled'],
  packed: ['sent', 'received', 'cancelled'],
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

export function normalizeDaybookTaskCopy(titleValue: unknown, instructionsValue: unknown) {
  const title = String(titleValue ?? '').trim().slice(0, 50);
  const instructions = String(instructionsValue ?? '').trim().slice(0, 600) || null;
  return { title, instructions };
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

export function getDaybookDateRange(endDate: string, days: number): string[] {
  const parsed = parseDaybookDate(endDate);
  if (!parsed || !Number.isInteger(days) || days < 1) return [];
  const [year, month, day] = parsed.split('-').map(Number);
  const end = new Date(Date.UTC(year, month - 1, day));
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (days - 1 - index));
    return date.toISOString().slice(0, 10);
  });
}

export function getDaybookDisplayDates(taskDates: readonly string[]): string[] {
  return [...taskDates].reverse();
}

export function getDaybookTaskDisplay(title: string, instructions?: string | null): { title: string; instructions: string } {
  const fullInstructions = String(instructions ?? '').trim();
  if (fullInstructions && fullInstructions.startsWith(title.trim())) {
    return { title: fullInstructions, instructions: '' };
  }
  return { title, instructions: fullInstructions };
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

export function normalizeDaybookColour(value: unknown): DaybookColourKey | null {
  const key = String(value ?? '');
  return DAYBOOK_COLOUR_KEYS.includes(key as DaybookColourKey) ? key as DaybookColourKey : null;
}

export function normalizeDaybookEditPolicy(value: unknown): DaybookEditPolicy {
  const policy = String(value ?? '');
  return DAYBOOK_EDIT_POLICIES.includes(policy as DaybookEditPolicy) ? policy as DaybookEditPolicy : 'managers';
}

export function normalizeDaybookTheme(value: unknown): DaybookTheme {
  const theme = String(value ?? '');
  return DAYBOOK_THEMES.includes(theme as DaybookTheme) ? theme as DaybookTheme : 'evergreen';
}

export function deriveDaybookCommunicationTitle(value: unknown): string {
  const plainValue = sanitizeHtml(String(value ?? ''), { allowedTags: [], allowedAttributes: {} });
  const firstLine = plainValue.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? '';
  const plainText = firstLine.replace(/^[-+>]\s+/, '').replace(/[*_`#~]/g, '').trim();
  return plainText.slice(0, 255) || 'Communication';
}

export function sanitizeDaybookCommunicationHtml(value: unknown): string {
  const html = sanitizeHtml(String(value ?? '').trim().slice(0, 20_000), {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li'],
    allowedAttributes: {},
  }).trim();
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim() ? html : '';
}

export function canEditDaybookComment(input: {
  isManager: boolean;
  actorUserId: number | null;
  staffIdentityId: number | null;
  staffInitials: string;
  authorUserId: number | null;
  authorStaffIdentityId: number | null;
  authorStaffInitials: string;
}): boolean {
  if (input.isManager) return true;
  if (input.staffIdentityId !== null && input.staffIdentityId === input.authorStaffIdentityId) return true;
  if (input.staffInitials && input.staffInitials.toUpperCase() === input.authorStaffInitials.toUpperCase()) return true;
  const hasStaffAuthor = input.authorStaffIdentityId !== null || Boolean(input.authorStaffInitials);
  return !hasStaffAuthor && input.actorUserId !== null && input.actorUserId === input.authorUserId;
}

export function canEditDaybookItem(input: {
  policy: DaybookEditPolicy;
  isManager: boolean;
  actorUserId: number | null;
  staffIdentityId: number | null;
  staffInitials: string;
  authorUserId: number | null;
  authorStaffIdentityId: number | null;
  authorStaffInitials: string;
}): boolean {
  if (input.policy === 'anyone') return true;
  if (input.policy === 'managers') return input.isManager;
  const hasRecordedAuthor = input.authorUserId !== null
    || input.authorStaffIdentityId !== null
    || Boolean(input.authorStaffInitials);
  if (!hasRecordedAuthor && input.isManager) return true;
  return (input.actorUserId !== null && input.actorUserId === input.authorUserId)
    || (input.staffIdentityId !== null && input.staffIdentityId === input.authorStaffIdentityId)
    || (Boolean(input.staffInitials) && input.staffInitials.toUpperCase() === input.authorStaffInitials.toUpperCase());
}

export function canManageDaybookTask(_input: Parameters<typeof canEditDaybookItem>[0]): boolean {
  return true;
}