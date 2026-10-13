import { describe, expect, it } from 'vitest';
import { isMarketingScheduledAutomationEnabled } from '../marketingAutomationSettings';

describe('marketing scheduled automation preference', () => {
  it.each([undefined, null, 'true'])('preserves enabled schedules when the preference is %s', value => {
    expect(isMarketingScheduledAutomationEnabled(value)).toBe(true);
  });

  it('disables schedules only for the explicitly saved off value', () => {
    expect(isMarketingScheduledAutomationEnabled('false')).toBe(false);
  });
});