import { describe, expect, it } from 'vitest';
import { calculateCycle } from '../cycles';
import { audToMicros, microsToAud, priceUnits } from '../money';

describe('AI billing money', () => {
  it('round-trips exact AUD values without floating point arithmetic', () => {
    expect(audToMicros('12.345678')).toBe(12_345_678n);
    expect(microsToAud(-12_340_000n)).toBe('-12.34');
  });

  it('rounds token charges up to the nearest AUD micro', () => {
    expect(priceUnits(1, 1_000_000n)).toBe(1n);
    expect(priceUnits(1_500_000, 2_000_000n)).toBe(3_000_000n);
  });
});

describe('AI account cycles', () => {
  it('calculates calendar-month cycles', () => {
    const cycle = calculateCycle('calendar_month', new Date('2026-08-29T12:00:00Z'))!;
    expect(cycle.start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(cycle.end.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('clamps anniversary cycles to month end', () => {
    const cycle = calculateCycle('billing_anniversary', new Date('2026-02-28T12:00:00Z'), 31)!;
    expect(cycle.start.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(cycle.end.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('does not automatically calculate manual cycles', () => {
    expect(calculateCycle('manual', new Date())).toBeNull();
  });

  it('starts calendar cycles at midnight in the account timezone', () => {
    const cycle = calculateCycle('calendar_month', new Date('2026-08-15T00:00:00Z'), 1, 'Australia/Sydney')!;
    expect(cycle.start.toISOString()).toBe('2026-07-31T14:00:00.000Z');
    expect(cycle.end.toISOString()).toBe('2026-08-31T14:00:00.000Z');
  });
});