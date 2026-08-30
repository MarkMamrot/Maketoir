export const AI_PLAN_KEYS = ['starter', 'core', 'scale', 'enterprise', 'platform'] as const;
export type AiPlanKey = typeof AI_PLAN_KEYS[number];

export const AI_FUNDING_MODES = ['prepaid', 'account_limit'] as const;
export type AiFundingMode = typeof AI_FUNDING_MODES[number];

export const AI_ENFORCEMENT_MODES = ['observe', 'enforce', 'suspended'] as const;
export type AiEnforcementMode = typeof AI_ENFORCEMENT_MODES[number];

export const AI_CYCLE_MODES = ['billing_anniversary', 'calendar_month', 'manual'] as const;
export type AiCycleMode = typeof AI_CYCLE_MODES[number];

export const AI_USAGE_AREAS = [
  'assistant', 'prospect_sales', 'document_extraction', 'catalogue_matching',
  'business_intelligence', 'foresight', 'customer_service', 'website_content',
  'product_creative_text', 'product_creative_image', 'product_creative_video',
] as const;
export type AiUsageArea = typeof AI_USAGE_AREAS[number];

export const AI_RATE_METRICS = [
  'input_tokens', 'cached_input_tokens', 'output_tokens', 'thinking_tokens',
  'input_tokens_over_200k', 'cached_input_tokens_over_200k',
  'output_tokens_over_200k', 'thinking_tokens_over_200k',
  'output_image_tokens', 'output_image', 'video_second',
] as const;
export type AiRateMetric = typeof AI_RATE_METRICS[number];

export type AiCallStatus = 'reserved' | 'submitted' | 'settled' | 'released' | 'unknown' | 'denied';
export type AiActorType = 'user' | 'cron' | 'webhook' | 'public' | 'system';

export interface AiUsageUnits {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  outputImageTokens: number;
  outputImages: number;
  videoSeconds: number;
}

export interface AiBillingContext {
  businessId: string;
  area: AiUsageArea;
  operation: string;
  actorType: AiActorType;
  actorUserId?: number | null;
  referenceType?: string | null;
  referenceId?: string | number | null;
  parentCallId?: number | null;
}

export interface AiAccountSnapshot {
  businessId: string;
  planKey: AiPlanKey;
  fundingMode: AiFundingMode;
  enforcementMode: AiEnforcementMode;
  cycleMode: AiCycleMode;
  balanceMicros: bigint;
  cycleLimitMicros: bigint;
  cycleUsedMicros: bigint;
  reservedMicros: bigint;
  cycleStart: string | null;
  cycleEnd: string | null;
  warningPercent: number;
}

export class AiUsageDeniedError extends Error {
  readonly code = 'AI_USAGE_UNAVAILABLE';
  constructor(
    message: string,
    readonly reason: 'suspended' | 'credits_exhausted' | 'account_limit_reached' | 'pricing_unavailable' | 'account_unavailable',
  ) {
    super(message);
    this.name = 'AiUsageDeniedError';
  }
}