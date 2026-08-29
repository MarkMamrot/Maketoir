import { describe, expect, it } from 'vitest';
import { AI_PLATFORM_ACCOUNT_ID } from '../googleGateway';

describe('tracked Google gateway', () => {
  it('uses a stable internal account for public prospect usage', () => {
    expect(AI_PLATFORM_ACCOUNT_ID).toBe('__solvantis_platform__');
  });
});