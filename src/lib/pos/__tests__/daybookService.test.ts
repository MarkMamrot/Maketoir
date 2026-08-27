import { describe, expect, it } from 'vitest';
import {
  calculateStockVariance,
  canTransitionDiscrepancy,
  canTransitionNeed,
  getDaybookDateRange,
  getDaybookDisplayDates,
  normalizeStaffIdentity,
  parseDaybookDate,
  resolveDaybookLocationId,
  shouldImportNewtownCommunication,
  taskOccursOnDate,
  canEditDaybookItem,
  normalizeDaybookColour,
  normalizeDaybookEditPolicy,
} from '../daybookService';

describe('Store Daybook rules', () => {
  it('keeps POS sessions pinned while allowing IMS sessions to select a location', () => {
    expect(resolveDaybookLocationId(4, 0)).toBe(4);
    expect(resolveDaybookLocationId(0, 7)).toBe(7);
    expect(resolveDaybookLocationId(4, 4)).toBe(4);
    expect(resolveDaybookLocationId(4, 7)).toBeNull();
    expect(resolveDaybookLocationId(0, 0)).toBeNull();
  });

  it('normalizes shared-login staff identity', () => {
    expect(normalizeStaffIdentity({ name: '  Holly   Green ', initials: ' h.g ' })).toEqual({
      id: null,
      name: 'Holly Green',
      initials: 'HG',
    });
  });

  it('parses spreadsheet dates without accepting impossible dates', () => {
    expect(parseDaybookDate('24.08.26')).toBe('2026-08-24');
    expect(parseDaybookDate('2026-08-24')).toBe('2026-08-24');
    expect(parseDaybookDate('31.02.26')).toBeNull();
  });

  it('builds an inclusive seven-day checklist window across calendar boundaries', () => {
    expect(getDaybookDateRange('2026-01-03', 7)).toEqual([
      '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31',
      '2026-01-01', '2026-01-02', '2026-01-03',
    ]);
    expect(getDaybookDateRange('invalid', 7)).toEqual([]);
  });

  it('shows the latest checklist date closest to the task list', () => {
    const taskDates = ['2026-08-25', '2026-08-26', '2026-08-27'];
    expect(getDaybookDisplayDates(taskDates)).toEqual(['2026-08-27', '2026-08-26', '2026-08-25']);
    expect(taskDates).toEqual(['2026-08-25', '2026-08-26', '2026-08-27']);
  });

  it('imports Newtown communications only from the start of 2026', () => {
    expect(shouldImportNewtownCommunication('31.12.25')).toBe(false);
    expect(shouldImportNewtownCommunication('01.01.26')).toBe(true);
    expect(shouldImportNewtownCommunication('26.02.26')).toBe(true);
  });

  it('materializes daily, weekly, and one-off work', () => {
    expect(taskOccursOnDate({ recurrence: 'daily' }, '2026-08-24')).toBe(true);
    expect(taskOccursOnDate({ recurrence: 'weekly', weekday: 1 }, '2026-08-24')).toBe(true);
    expect(taskOccursOnDate({ recurrence: 'once', scheduledDate: '2026-08-25' }, '2026-08-24')).toBe(false);
  });

  it('calculates physical minus system stock and enforces staged workflows', () => {
    expect(calculateStockVariance(4, 3)).toBe(-1);
    expect(canTransitionNeed('requested', 'approved')).toBe(true);
    expect(canTransitionNeed('requested', 'sent')).toBe(false);
    expect(canTransitionDiscrepancy('open', 'stocktake_planned')).toBe(true);
    expect(canTransitionDiscrepancy('closed', 'open')).toBe(false);
  });

  it('allows only controlled Daybook colours', () => {
    expect(normalizeDaybookColour('pastel_mint')).toBe('pastel_mint');
    expect(normalizeDaybookColour('#000000')).toBeNull();
    expect(normalizeDaybookColour('fluoro_orange')).toBeNull();
  });

  it('normalizes edit policy and respects shared-login staff authorship', () => {
    expect(normalizeDaybookEditPolicy('anyone')).toBe('anyone');
    expect(normalizeDaybookEditPolicy('invalid')).toBe('managers');
    expect(canEditDaybookItem({ policy: 'managers', isManager: true, actorUserId: 1, staffIdentityId: 2, staffInitials: 'HG', authorUserId: 9, authorStaffIdentityId: 8, authorStaffInitials: 'LM' })).toBe(true);
    expect(canEditDaybookItem({ policy: 'author_only', isManager: false, actorUserId: 1, staffIdentityId: 2, staffInitials: 'HG', authorUserId: 9, authorStaffIdentityId: 2, authorStaffInitials: 'HG' })).toBe(true);
    expect(canEditDaybookItem({ policy: 'author_only', isManager: true, actorUserId: 1, staffIdentityId: 2, staffInitials: 'HG', authorUserId: 9, authorStaffIdentityId: 8, authorStaffInitials: 'LM' })).toBe(false);
    expect(canEditDaybookItem({ policy: 'author_only', isManager: true, actorUserId: 1, staffIdentityId: 2, staffInitials: 'HG', authorUserId: null, authorStaffIdentityId: null, authorStaffInitials: '' })).toBe(true);
  });
});