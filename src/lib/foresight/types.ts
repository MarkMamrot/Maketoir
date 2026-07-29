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
  contributors?: PaidMediaContributorEvidence[];
  lifecycleFlowCoverage?: KlaviyoFlowCoverageEvidence[];
}

export interface KlaviyoFlowCoverageEvidence {
  category: 'welcome' | 'abandoned_cart' | 'browse_abandonment' | 'post_purchase' | 'win_back' | 'vip_loyalty';
  label: string;
  state: 'active' | 'inactive' | 'missing';
  matchedFlows: Array<{
    id: string;
    name: string;
    status: string;
    archived: boolean;
  }>;
}

export interface PaidMediaContributorEvidence {
  source: 'google_ads' | 'meta_ads';
  entityType: 'campaign' | 'adset';
  entityId: string;
  entityName: string;
  parentEntityId: string | null;
  parentEntityName: string | null;
  currentSpend: number;
  previousSpend: number;
  spendChange: number;
  currentAttributedRevenue: number;
  previousAttributedRevenue: number;
  currentPlatformRoas: number | null;
  previousPlatformRoas: number | null;
  platformRoasChangePercent: number | null;
  diagnosticScore: number;
  signals: Array<'new_spend' | 'spend_increase' | 'platform_roas_decline' | 'spend_without_platform_revenue'>;
}
