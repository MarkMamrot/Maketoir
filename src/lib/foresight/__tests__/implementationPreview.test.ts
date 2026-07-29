import { describe, expect, it } from 'vitest';
import { buildRecommendationImplementationPreview } from '../implementationPreview';

describe('recommendation implementation preview', () => {
  it('renders a capped manual budget review without implying execution', () => {
    const preview = buildRecommendationImplementationPreview('paid_media', {
      type: 'review_budget_reduction',
      maximumReductionPercent: 8,
    });

    expect(preview).toMatchObject({ mode: 'manual_external', executable: false });
    expect(preview.summary).toContain('8%');
    expect(preview.guardrails.join(' ')).toContain('No reviewed budget reduction may exceed 8%');
  });

  it('names Klaviyo gaps but still requires validation before activation', () => {
    const preview = buildRecommendationImplementationPreview('klaviyo', {
      type: 'review_klaviyo_lifecycle_flows',
      missingCategories: ['Win-back'],
      inactiveCategories: ['Welcome series'],
    });

    expect(preview.steps).toEqual(expect.arrayContaining([
      'Review missing categories: Win-back.',
      'Review inactive categories: Welcome series.',
    ]));
    expect(preview.guardrails.join(' ')).toContain('test messages');
  });

  it('does not invent a specific mutation for an unknown action', () => {
    const preview = buildRecommendationImplementationPreview('meta_ads', { type: 'future_action' });

    expect(preview.executable).toBe(false);
    expect(preview.summary).toContain('does not contain enough structured detail');
  });
});