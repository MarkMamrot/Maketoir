import { describe, expect, it } from 'vitest';
import { buildCampaignMeasurementSchedule } from '../planning/activationSchedule';

describe('buildCampaignMeasurementSchedule', () => {
  it('excludes the partial activation day from equal baseline and follow-up windows', () => {
    expect(buildCampaignMeasurementSchedule('2026-08-01', 7)).toEqual({
      horizonDays: 7,
      baselineStart: '2026-07-25',
      baselineEnd: '2026-07-31',
      followupStart: '2026-08-02',
      followupEnd: '2026-08-08',
      firstAssessmentDate: '2026-08-09',
    });
  });

  it('rejects invalid dates and unbounded horizons', () => {
    expect(() => buildCampaignMeasurementSchedule('2026-02-30', 7)).toThrow('valid YYYY-MM-DD');
    expect(() => buildCampaignMeasurementSchedule('2026-08-01', 91)).toThrow('1 to 90');
  });
});