export type ForesightChannel = 'paid_media' | 'google_ads' | 'meta_ads' | 'ga4' | 'klaviyo';

export type DataQualityGrade = 'good' | 'partial' | 'blocked';

export interface DataQualityIssue {
  code: string;
  severity: 'warning' | 'blocking';
  message: string;
}

export interface DataQualityResult {
  grade: DataQualityGrade;
  issues: DataQualityIssue[];
}

export interface ForesightMetric<TValue = number | null> {
  key: string;
  value: TValue;
  formulaVersion: string;
  quality: DataQualityResult;
}

export type RecommendationState =
  | 'draft'
  | 'shadow'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'compensated';

export interface RecommendationEvidence {
  metricKeys: string[];
  sourceIds: string[];
  windowStart: string;
  windowEnd: string;
  quality: DataQualityResult;
  observedValues?: Record<string, number | null>;
}
