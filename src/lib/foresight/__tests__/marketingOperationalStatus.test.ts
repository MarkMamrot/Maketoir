import { describe, expect, it } from 'vitest';
import { buildMarketingOperationalStatus } from '../marketingOperationalStatus';

describe('buildMarketingOperationalStatus', () => {
  it('keeps a completed recommendation in monitoring through day seven', () => {
    expect(buildMarketingOperationalStatus({ recommendationId: 20, businessToday: '2026-08-08', completionDate: '2026-08-01', hasOutcome: false }).followup)
      .toEqual({ status: 'monitoring', followupStart: '2026-08-02', followupEnd: '2026-08-08', assessmentDue: '2026-08-09' });
  });

  it('marks the recommendation outcome due on day eight and measured once present', () => {
    expect(buildMarketingOperationalStatus({ recommendationId: 20, businessToday: '2026-08-09', completionDate: '2026-08-01', hasOutcome: false }).followup?.status)
      .toBe('outcome_due');
    expect(buildMarketingOperationalStatus({ recommendationId: 20, businessToday: '2026-08-09', completionDate: '2026-08-01', hasOutcome: true }).followup?.status)
      .toBe('measured');
  });

  it('classifies accepted experiment workflows without implying authorization', () => {
    expect(buildMarketingOperationalStatus({ recommendationId: 20, businessToday: '2026-08-01', hasOutcome: false,
      experiment: { scheduledEndOn: null, conclusion: null, conclusionReview: null } }).experiment?.status).toBe('awaiting_launch');
    expect(buildMarketingOperationalStatus({ recommendationId: 20, businessToday: '2026-08-12', hasOutcome: false,
      experiment: { scheduledEndOn: '2026-08-16', conclusion: null, conclusionReview: null } }).experiment?.status).toBe('running');
    expect(buildMarketingOperationalStatus({ recommendationId: 20, businessToday: '2026-08-16', hasOutcome: false,
      experiment: { scheduledEndOn: '2026-08-16', conclusion: null, conclusionReview: null } }).experiment?.status).toBe('evidence_due');
    expect(buildMarketingOperationalStatus({ recommendationId: 20, businessToday: '2026-08-17', hasOutcome: false,
      experiment: { scheduledEndOn: '2026-08-16', conclusion: 'treatment_won', conclusionReview: null } }).experiment?.status).toBe('conclusion_review_due');
    expect(buildMarketingOperationalStatus({ recommendationId: 20, businessToday: '2026-08-17', hasOutcome: false,
      experiment: { scheduledEndOn: '2026-08-16', conclusion: 'treatment_won', conclusionReview: 'acknowledged' } }).experiment?.status).toBe('concluded');
    expect(buildMarketingOperationalStatus({ recommendationId: 20, businessToday: '2026-08-17', hasOutcome: false,
      experiment: { scheduledEndOn: '2026-08-16', conclusion: 'treatment_won', conclusionReview: 'rejected' } }).experiment?.status).toBe('conclusion_rejected');
  });
});