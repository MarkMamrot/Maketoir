import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORESIGHT_MARKETING_STRATEGY,
  MarketingStrategyValidationError,
  parseMarketingStrategy,
  renderMarketingStrategyMarkdown,
} from '../marketingStrategy';

describe('Foresight marketing strategy', () => {
  it('accepts the conservative default strategy', () => {
    expect(parseMarketingStrategy(DEFAULT_FORESIGHT_MARKETING_STRATEGY))
      .toEqual(DEFAULT_FORESIGHT_MARKETING_STRATEGY);
  });

  it('rejects unsafe or malformed guardrails', () => {
    expect(() => parseMarketingStrategy({
      ...DEFAULT_FORESIGHT_MARKETING_STRATEGY,
      paidMedia: {
        ...DEFAULT_FORESIGHT_MARKETING_STRATEGY.paidMedia,
        evaluationWindowDays: 2.5,
        maximumBudgetReductionPercent: 75,
      },
    })).toThrow(MarketingStrategyValidationError);
  });

  it('renders an auditable Markdown strategy without implying execution', () => {
    const markdown = renderMarketingStrategyMarkdown(DEFAULT_FORESIGHT_MARKETING_STRATEGY);
    expect(markdown).toContain('Target blended MER: 3');
    expect(markdown).toContain('Maximum suggested budget reduction: 10%');
    expect(markdown).toContain('Profitable-growth contribution POAS floor: 3');
    expect(markdown).toContain('Maximum suggested budget increase: 10%');
    expect(markdown).toContain('Meta diagnostic minimum spend: AUD 25');
    expect(markdown).toContain('Meta diagnostic maximum ROAS: 1');
    expect(markdown).toContain('does not execute changes');
  });
});