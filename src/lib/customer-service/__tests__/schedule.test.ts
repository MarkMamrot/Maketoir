import { describe, expect, it } from 'vitest';
import { getDueCustomerServiceSchedule } from '../schedule';
import { normalizeRunTimes } from '../types';

describe('customer service schedule', () => {
  it('normalizes, sorts, and deduplicates valid local run times', () => {
    expect(normalizeRunTimes(['16:00', 'bad', '10:00', '10:00'])).toEqual(['10:00', '16:00']);
  });

  it('is due within the dispatcher window and only once', () => {
    const now = new Date('2026-07-28T00:07:00.000Z'); // 10:07 Australia/Sydney

    expect(getDueCustomerServiceSchedule({
      now,
      lastRunAt: new Date('2026-07-27T06:00:00.000Z'),
      timeZone: 'Australia/Sydney',
      runTimes: ['10:00', '16:00'],
    })).toEqual({ due: true, scheduledLocalTime: '2026-07-28T10:00' });

    expect(getDueCustomerServiceSchedule({
      now,
      lastRunAt: new Date('2026-07-28T00:02:00.000Z'),
      timeZone: 'Australia/Sydney',
      runTimes: ['10:00', '16:00'],
    }).due).toBe(false);
  });

  it('does not run a stale schedule after the dispatcher window', () => {
    expect(getDueCustomerServiceSchedule({
      now: new Date('2026-07-28T00:20:00.000Z'),
      lastRunAt: null,
      timeZone: 'Australia/Sydney',
      runTimes: ['10:00'],
    }).due).toBe(false);
  });

  it('uses the business timezone across daylight-saving changes', () => {
    expect(getDueCustomerServiceSchedule({
      now: new Date('2026-01-15T23:05:00.000Z'), // 10:05 AEDT next day
      lastRunAt: null,
      timeZone: 'Australia/Sydney',
      runTimes: ['10:00'],
    })).toEqual({ due: true, scheduledLocalTime: '2026-01-16T10:00' });
  });
});