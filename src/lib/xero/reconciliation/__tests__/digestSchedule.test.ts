import { describe, expect, it } from 'vitest';

import { getReconciliationDigestSchedule } from '../digestSchedule';

describe('getReconciliationDigestSchedule', () => {
  it('waits for the configured local hour and suppresses a completed daily period', () => {
    expect(getReconciliationDigestSchedule({
      now: new Date('2026-08-09T20:30:00Z'), lastCompletedAt: new Date('2026-08-08T22:05:00Z'),
      timeZone: 'Australia/Sydney', frequency: 'daily', localHour: 8, weeklyDay: 1,
    })).toMatchObject({ due: false, periodKey: 'daily-2026-08-09' });

    expect(getReconciliationDigestSchedule({
      now: new Date('2026-08-09T22:30:00Z'), lastCompletedAt: new Date('2026-08-09T22:05:00Z'),
      timeZone: 'Australia/Sydney', frequency: 'daily', localHour: 8, weeklyDay: 1,
    })).toMatchObject({ due: false, periodKey: 'daily-2026-08-10' });
  });

  it('catches up a missed daily period on the next dispatcher run', () => {
    expect(getReconciliationDigestSchedule({
      now: new Date('2026-08-10T03:00:00Z'), lastCompletedAt: new Date('2026-08-08T22:05:00Z'),
      timeZone: 'Australia/Sydney', frequency: 'daily', localHour: 8, weeklyDay: 1,
    })).toMatchObject({ due: true, periodKey: 'daily-2026-08-10' });
  });

  it('uses the latest configured weekday and catches up after that local day', () => {
    expect(getReconciliationDigestSchedule({
      now: new Date('2026-08-12T02:00:00Z'), lastCompletedAt: new Date('2026-08-02T22:00:00Z'),
      timeZone: 'Australia/Sydney', frequency: 'weekly', localHour: 8, weeklyDay: 1,
    })).toMatchObject({ due: true, periodKey: 'weekly-2026-08-10' });
  });

  it('uses local time across daylight-saving offsets', () => {
    expect(getReconciliationDigestSchedule({
      now: new Date('2026-12-06T22:30:00Z'), lastCompletedAt: null,
      timeZone: 'Australia/Sydney', frequency: 'daily', localHour: 9, weeklyDay: 1,
    })).toMatchObject({ due: true, periodKey: 'daily-2026-12-07' });
  });
});