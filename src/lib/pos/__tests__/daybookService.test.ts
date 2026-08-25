import { describe, expect, it } from 'vitest';
import {
  calculateStockVariance,
  canTransitionDiscrepancy,
  canTransitionNeed,
  normalizeStaffIdentity,
  parseDaybookDate,
  shouldImportNewtownCommunication,
  taskOccursOnDate,
} from '../daybookService';

describe('Store Daybook rules', () => {
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
});