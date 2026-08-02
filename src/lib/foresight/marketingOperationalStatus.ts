export const PAID_MEDIA_OUTCOME_HORIZON_DAYS = 7;

export type RecommendationFollowupStatus = 'monitoring' | 'outcome_due' | 'measured';
export type ExperimentWorkflowStatus = 'awaiting_launch' | 'running' | 'evidence_due' | 'conclusion_review_due' | 'concluded' | 'conclusion_rejected';

export interface MarketingOperationalStatus {
  recommendationId: number;
  followup: {
    status: RecommendationFollowupStatus;
    followupStart: string | null;
    followupEnd: string | null;
    assessmentDue: string | null;
  } | null;
  experiment: {
    status: ExperimentWorkflowStatus;
    scheduledEndOn: string | null;
    conclusion: string | null;
  } | null;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildMarketingOperationalStatus(input: {
  recommendationId: number;
  businessToday: string;
  completionDate?: string | null;
  hasOutcome: boolean;
  experiment?: { scheduledEndOn: string | null; conclusion: string | null; conclusionReview: 'acknowledged' | 'rejected' | null } | null;
}): MarketingOperationalStatus {
  let followup: MarketingOperationalStatus['followup'] = null;
  if (input.hasOutcome) {
    followup = { status: 'measured', followupStart: null, followupEnd: null, assessmentDue: null };
  } else if (input.completionDate) {
    const followupStart = addDays(input.completionDate, 1);
    const followupEnd = addDays(input.completionDate, PAID_MEDIA_OUTCOME_HORIZON_DAYS);
    const assessmentDue = addDays(input.completionDate, PAID_MEDIA_OUTCOME_HORIZON_DAYS + 1);
    followup = {
      status: input.businessToday >= assessmentDue ? 'outcome_due' : 'monitoring',
      followupStart,
      followupEnd,
      assessmentDue,
    };
  }

  let experiment: MarketingOperationalStatus['experiment'] = null;
  if (input.experiment) {
    const status: ExperimentWorkflowStatus = input.experiment.conclusion
      ? input.experiment.conclusionReview === 'acknowledged'
        ? 'concluded'
        : input.experiment.conclusionReview === 'rejected'
          ? 'conclusion_rejected'
          : 'conclusion_review_due'
      : input.experiment.scheduledEndOn == null
        ? 'awaiting_launch'
        : input.businessToday >= input.experiment.scheduledEndOn
          ? 'evidence_due'
          : 'running';
    experiment = { status, scheduledEndOn: input.experiment.scheduledEndOn, conclusion: input.experiment.conclusion };
  }

  return { recommendationId: input.recommendationId, followup, experiment };
}