import { describe, expect, it } from 'vitest';

import {
  isRecentInvalidUrlAttempt,
  normalizeInvalidUrlExclusionDays,
} from '../recentWebsiteAttempts';

describe('recent website attempts', () => {
  const now = Date.parse('2026-08-04T12:00:00.000Z');

  it('excludes attempts strictly inside the configured window', () => {
    expect(isRecentInvalidUrlAttempt('2026-08-01T12:00:01.000Z', 3, now)).toBe(true);
    expect(isRecentInvalidUrlAttempt('2026-08-01T12:00:00.000Z', 3, now)).toBe(false);
  });

  it('allows zero days to disable exclusion', () => {
    expect(isRecentInvalidUrlAttempt('2026-08-04T11:00:00.000Z', 0, now)).toBe(false);
  });

  it('normalizes customer settings to the supported range', () => {
    expect(normalizeInvalidUrlExclusionDays('7')).toBe(7);
    expect(normalizeInvalidUrlExclusionDays(-4)).toBe(0);
    expect(normalizeInvalidUrlExclusionDays(120)).toBe(90);
    expect(normalizeInvalidUrlExclusionDays('invalid')).toBe(5);
  });
});