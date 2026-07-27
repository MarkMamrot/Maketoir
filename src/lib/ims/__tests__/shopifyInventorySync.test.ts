import { describe, expect, it } from 'vitest';
import { shouldRunInventorySync } from '../shopifyInventorySync';

describe('shouldRunInventorySync', () => {
  it('runs immediately when there is no previous run', () => {
    expect(shouldRunInventorySync(null, 15, new Date('2024-01-01T00:00:00.000Z'))).toBe(true);
  });

  it('runs when the configured interval has elapsed', () => {
    expect(shouldRunInventorySync('2024-01-01T00:00:00.000Z', 15, new Date('2024-01-01T00:15:00.000Z'))).toBe(true);
  });

  it('skips when the interval has not elapsed yet', () => {
    expect(shouldRunInventorySync('2024-01-01T00:00:00.000Z', 15, new Date('2024-01-01T00:14:59.000Z'))).toBe(false);
  });
});
