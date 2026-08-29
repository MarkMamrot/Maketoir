export const FORESIGHT_MARKETING_STRATEGY_VERSION = 1;

export type MarketingObjective = 'profitable_growth' | 'revenue_growth' | 'efficiency';

export interface ForesightMarketingStrategy {
  schemaVersion: 1;
  objective: MarketingObjective;
  paidMedia: {
    targetMer: number;
    minimumContributionPoas: number;
    evaluationWindowDays: number;
    minimumSpend: number;
    zeroRevenueSpend: number;
    merDeteriorationPercent: number;
    maximumBudgetReductionPercent: number;
    growthMinimumContributionPoas: number;
    maximumBudgetIncreasePercent: number;
    metaMinimumSpend: number;
    metaMaximumRoas: number;
  };
}

export const DEFAULT_FORESIGHT_MARKETING_STRATEGY: ForesightMarketingStrategy = {
  schemaVersion: FORESIGHT_MARKETING_STRATEGY_VERSION,
  objective: 'profitable_growth',
  paidMedia: {
    targetMer: 3,
    minimumContributionPoas: 1,
    evaluationWindowDays: 7,
    minimumSpend: 100,
    zeroRevenueSpend: 100,
    merDeteriorationPercent: 25,
    maximumBudgetReductionPercent: 10,
    growthMinimumContributionPoas: 3,
    maximumBudgetIncreasePercent: 10,
    metaMinimumSpend: 25,
    metaMaximumRoas: 1,
  },
};

export class MarketingStrategyValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super('Invalid Intel & Automation marketing strategy.');
    this.name = 'MarketingStrategyValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function boundedNumber(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  issues: string[],
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    issues.push(`${path} must be a number from ${minimum} to ${maximum}.`);
    return minimum;
  }
  return value;
}

export function parseMarketingStrategy(value: unknown): ForesightMarketingStrategy {
  const issues: string[] = [];
  if (!isRecord(value)) throw new MarketingStrategyValidationError(['strategy must be an object.']);
  const paidMedia = isRecord(value.paidMedia) ? value.paidMedia : {};
  if (!isRecord(value.paidMedia)) issues.push('paidMedia must be an object.');

  const objectives: MarketingObjective[] = ['profitable_growth', 'revenue_growth', 'efficiency'];
  const objective = objectives.includes(value.objective as MarketingObjective)
    ? value.objective as MarketingObjective
    : 'profitable_growth';
  if (!objectives.includes(value.objective as MarketingObjective)) {
    issues.push('objective must be profitable_growth, revenue_growth, or efficiency.');
  }

  if (value.schemaVersion !== FORESIGHT_MARKETING_STRATEGY_VERSION) {
    issues.push(`schemaVersion must be ${FORESIGHT_MARKETING_STRATEGY_VERSION}.`);
  }

  const strategy: ForesightMarketingStrategy = {
    schemaVersion: FORESIGHT_MARKETING_STRATEGY_VERSION,
    objective,
    paidMedia: {
      targetMer: boundedNumber(paidMedia.targetMer, 'paidMedia.targetMer', 0.1, 100, issues),
      minimumContributionPoas: boundedNumber(
        paidMedia.minimumContributionPoas,
        'paidMedia.minimumContributionPoas',
        0,
        20,
        issues,
      ),
      evaluationWindowDays: boundedNumber(
        paidMedia.evaluationWindowDays,
        'paidMedia.evaluationWindowDays',
        3,
        30,
        issues,
      ),
      minimumSpend: boundedNumber(paidMedia.minimumSpend, 'paidMedia.minimumSpend', 0, 1000000, issues),
      zeroRevenueSpend: boundedNumber(
        paidMedia.zeroRevenueSpend,
        'paidMedia.zeroRevenueSpend',
        0,
        1000000,
        issues,
      ),
      merDeteriorationPercent: boundedNumber(
        paidMedia.merDeteriorationPercent,
        'paidMedia.merDeteriorationPercent',
        1,
        100,
        issues,
      ),
      maximumBudgetReductionPercent: boundedNumber(
        paidMedia.maximumBudgetReductionPercent,
        'paidMedia.maximumBudgetReductionPercent',
        0,
        50,
        issues,
      ),
      growthMinimumContributionPoas: boundedNumber(
        paidMedia.growthMinimumContributionPoas ?? DEFAULT_FORESIGHT_MARKETING_STRATEGY.paidMedia.growthMinimumContributionPoas,
        'paidMedia.growthMinimumContributionPoas',
        1,
        20,
        issues,
      ),
      maximumBudgetIncreasePercent: boundedNumber(
        paidMedia.maximumBudgetIncreasePercent ?? DEFAULT_FORESIGHT_MARKETING_STRATEGY.paidMedia.maximumBudgetIncreasePercent,
        'paidMedia.maximumBudgetIncreasePercent',
        0,
        25,
        issues,
      ),
      metaMinimumSpend: boundedNumber(
        paidMedia.metaMinimumSpend ?? DEFAULT_FORESIGHT_MARKETING_STRATEGY.paidMedia.metaMinimumSpend,
        'paidMedia.metaMinimumSpend',
        0,
        1000000,
        issues,
      ),
      metaMaximumRoas: boundedNumber(
        paidMedia.metaMaximumRoas ?? DEFAULT_FORESIGHT_MARKETING_STRATEGY.paidMedia.metaMaximumRoas,
        'paidMedia.metaMaximumRoas',
        0,
        100,
        issues,
      ),
    },
  };

  if (!Number.isInteger(strategy.paidMedia.evaluationWindowDays)) {
    issues.push('paidMedia.evaluationWindowDays must be a whole number.');
  }
  if (issues.length > 0) throw new MarketingStrategyValidationError(issues);
  return strategy;
}

export function renderMarketingStrategyMarkdown(strategy: ForesightMarketingStrategy): string {
  const objective = strategy.objective.replaceAll('_', ' ');
  return [
    '# Intel & Automation Marketing Strategy',
    '',
    `- Objective: ${objective}`,
    `- Target blended MER: ${strategy.paidMedia.targetMer}`,
    `- Minimum contribution POAS: ${strategy.paidMedia.minimumContributionPoas}`,
    `- Evaluation window: ${strategy.paidMedia.evaluationWindowDays} days`,
    `- Minimum paid-media spend: AUD ${strategy.paidMedia.minimumSpend}`,
    `- Zero-revenue spend threshold: AUD ${strategy.paidMedia.zeroRevenueSpend}`,
    `- MER deterioration tolerance: ${strategy.paidMedia.merDeteriorationPercent}%`,
    `- Maximum suggested budget reduction: ${strategy.paidMedia.maximumBudgetReductionPercent}%`,
    `- Profitable-growth contribution POAS floor: ${strategy.paidMedia.growthMinimumContributionPoas}`,
    `- Maximum suggested budget increase: ${strategy.paidMedia.maximumBudgetIncreasePercent}%`,
    `- Meta diagnostic minimum spend: AUD ${strategy.paidMedia.metaMinimumSpend}`,
    `- Meta diagnostic maximum ROAS: ${strategy.paidMedia.metaMaximumRoas}`,
    '',
    'Approval authorizes planning only. It does not execute changes in Google or Meta.',
  ].join('\n');
}